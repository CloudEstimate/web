import { GoogleAuth } from "google-auth-library";
import { logger } from "firebase-functions/v2";
import { providerTargets, resolveProjectId } from "../config.mjs";
import { getShapeMappings } from "../runtime-data.mjs";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-billing.readonly"]
});

const seriesMatchers = {
  n4: {
    onDemandCore: [/\bN4 Instance Core\b/i, /\bN4 Predefined Instance Core\b/i],
    onDemandRam: [/\bN4 Instance Ram\b/i, /\bN4 Predefined Instance Ram\b/i],
    commitCore: [/\bN4 Cpu\b/i, /\bN4 Instance Core\b/i],
    commitRam: [/\bN4 Ram\b/i, /\bN4 Instance Ram\b/i]
  },
  n2: {
    onDemandCore: [/\bN2 Instance Core\b/i, /\bN2 Predefined Instance Core\b/i],
    onDemandRam: [/\bN2 Instance Ram\b/i, /\bN2 Predefined Instance Ram\b/i],
    commitCore: [/\bN2 Cpu\b/i, /\bN2 Predefined Instance Core\b/i, /\bN2 Instance Core\b/i],
    commitRam: [/\bN2 Ram\b/i, /\bN2 Predefined Instance Ram\b/i, /\bN2 Instance Ram\b/i]
  },
  c4a: {
    onDemandCore: [/\bC4A Arm Instance Core\b/i, /\bC4A Instance Core\b/i],
    onDemandRam: [/\bC4A Arm Instance Ram\b/i, /\bC4A Instance Ram\b/i],
    commitCore: [/\bC4A Arm Cpu\b/i, /\bC4A Cpu\b/i],
    commitRam: [/\bC4A Arm Ram\b/i, /\bC4A Ram\b/i]
  },
  g2: {
    onDemandCore: [/\bG2 Instance Core\b/i],
    onDemandRam: [/\bG2 Instance Ram\b/i],
    commitCore: [/\bG2 Cpu\b/i, /\bG2 Instance Core\b/i],
    commitRam: [/\bG2 Ram\b/i, /\bG2 Instance Ram\b/i],
    onDemandGpu: [/\bNvidia L4 GPU\b/i],
    commitGpu: [/\bNvidia L4 GPU\b/i]
  }
};

export async function fetchGcpPricing({ regions, machineTypes }) {
  const headers = await getGoogleHeaders();
  const services = await fetchGoogleJson("https://cloudbilling.googleapis.com/v1/services", headers);
  const computeServiceName = services.services.find((service) => service.displayName === "Compute Engine")?.name;
  const storageServiceName = services.services.find((service) => service.displayName === "Cloud Storage")?.name;

  if (!computeServiceName || !storageServiceName) {
    throw new Error("Failed to discover required Google Cloud billing services.");
  }

  const [computeSkus, storageSkus] = await Promise.all([
    fetchAllGoogleSkus(computeServiceName, headers),
    fetchAllGoogleSkus(storageServiceName, headers)
  ]);
  const shapeMappings = getShapeMappings();
  const machineSpecs = buildMachineSpecMap(shapeMappings);

  return {
    cloud: "gcp",
    retrieved_at: new Date().toISOString(),
    regions: Object.fromEntries(
      regions.map((region) => {
        const regionCompute = Object.fromEntries(
          machineTypes.map((machineType) => {
            const spec = machineSpecs[machineType];
            if (!spec) {
              throw new Error(`Missing machine spec definition for GCP machine type ${machineType}.`);
            }

            const seriesKey = machineType.split("-")[0]?.toLowerCase();
            const matchers = seriesMatchers[seriesKey];
            if (!matchers) {
              throw new Error(`Unsupported GCP machine series "${seriesKey}" for ${machineType}.`);
            }

            const gpuCount = spec.gpu ?? 0;
            const onDemandGpu =
              gpuCount > 0 && matchers.onDemandGpu
                ? getComputeRate(computeSkus, region, "OnDemand", matchers.onDemandGpu, gpuCount)
                : 0;
            const commit1YrGpu =
              gpuCount > 0 && matchers.commitGpu
                ? getComputeRate(computeSkus, region, "Commit1Yr", matchers.commitGpu, gpuCount)
                : 0;
            const commit3YrGpu =
              gpuCount > 0 && matchers.commitGpu
                ? getComputeRate(computeSkus, region, "Commit3Yr", matchers.commitGpu, gpuCount)
                : 0;

            const rates = {
              on_demand_hourly_usd:
                getComputeRate(computeSkus, region, "OnDemand", matchers.onDemandCore, spec.vcpu) +
                getComputeRate(computeSkus, region, "OnDemand", matchers.onDemandRam, spec.memoryGb) +
                onDemandGpu,
              reserved_1yr_hourly_usd:
                getComputeRate(computeSkus, region, "Commit1Yr", matchers.commitCore, spec.vcpu) +
                getComputeRate(computeSkus, region, "Commit1Yr", matchers.commitRam, spec.memoryGb) +
                commit1YrGpu,
              reserved_3yr_hourly_usd:
                getComputeRate(computeSkus, region, "Commit3Yr", matchers.commitCore, spec.vcpu) +
                getComputeRate(computeSkus, region, "Commit3Yr", matchers.commitRam, spec.memoryGb) +
                commit3YrGpu
            };

            return [machineType, rates];
          })
        );

        return [
          region,
          {
            compute: regionCompute,
            storage: {
              ssd_gb_month_usd: findSkuRate(
                computeSkus,
                region,
                null,
                providerTargets.gcp.storagePatterns.ssd.include,
                providerTargets.gcp.storagePatterns.ssd.exclude
              ),
              hdd_gb_month_usd: findSkuRate(
                computeSkus,
                region,
                null,
                providerTargets.gcp.storagePatterns.hdd.include,
                providerTargets.gcp.storagePatterns.hdd.exclude
              ),
              nvme_gb_month_usd: findSkuRate(
                computeSkus,
                region,
                null,
                providerTargets.gcp.storagePatterns.nvme.include,
                providerTargets.gcp.storagePatterns.nvme.exclude
              ),
              object_gb_month_usd: findSkuRate(
                storageSkus,
                region,
                null,
                providerTargets.gcp.storagePatterns.object.include,
                providerTargets.gcp.storagePatterns.object.exclude
              )
            },
            other: {
              load_balancer_monthly_usd: region === "asia-southeast1" || region === "europe-west1" ? 19 : 18
            }
          }
        ];
      })
    )
  };
}

function buildMachineSpecMap(shapeMappings) {
  const specs = {};

  for (const mapping of shapeMappings) {
    if (mapping.gcp) {
      specs[mapping.gcp] = {
        vcpu: mapping.vcpu,
        memoryGb: mapping.memory_gb,
        gpu: mapping.gpu ?? 0
      };
    }

    if (mapping.arm_gcp) {
      specs[mapping.arm_gcp] = {
        vcpu: mapping.vcpu,
        memoryGb: mapping.memory_gb,
        gpu: 0
      };
    }
  }

  return specs;
}

async function getGoogleHeaders() {
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();
  const quotaProject = process.env.GOOGLE_CLOUD_QUOTA_PROJECT || resolveProjectId();

  if (quotaProject && !headers["x-goog-user-project"]) {
    headers["x-goog-user-project"] = quotaProject;
  }

  return headers;
}

async function fetchGoogleJson(url, headers) {
  const response = await fetch(url, {
    headers
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Cloud Billing request failed: ${response.status} ${response.statusText}. ${errorBody}`);
  }

  return response.json();
}

async function fetchAllGoogleSkus(serviceName, headers) {
  const items = [];
  let pageToken = "";

  do {
    const query = new URLSearchParams({ pageSize: "5000" });
    if (pageToken) {
      query.set("pageToken", pageToken);
    }

    const payload = await fetchGoogleJson(`https://cloudbilling.googleapis.com/v1/${serviceName}/skus?${query.toString()}`, headers);
    items.push(...(payload.skus ?? []));
    pageToken = payload.nextPageToken ?? "";
  } while (pageToken);

  logger.info(`Fetched ${items.length} Google Cloud billing SKUs for ${serviceName}.`);
  return items;
}

function getComputeRate(skus, region, usageType, descriptionMatchers, multiplier) {
  const matchers = Array.isArray(descriptionMatchers) ? descriptionMatchers : [descriptionMatchers];

  for (const matcher of matchers) {
    const sku = skus.find(
      (candidate) =>
        matchesSkuDescription(candidate.description, matcher) &&
        !/Custom|Sole Tenancy|Spot|Preemptible|DWS|Confidential/i.test(candidate.description ?? "") &&
        candidate.category?.usageType === usageType &&
        candidate.serviceRegions?.includes(region)
    );

    if (sku) return getSkuUnitPrice(sku) * multiplier;
  }

  const matcherLabels = matchers.map(formatSkuDescriptionMatcher);
  throw new Error(`Missing Google Cloud SKU for ${matcherLabels[0]} in ${region} (${usageType}).`);
}

function matchesSkuDescription(description, matcher) {
  if (!description) return false;
  if (matcher instanceof RegExp) return matcher.test(description);
  return description.includes(matcher);
}

function formatSkuDescriptionMatcher(matcher) {
  return matcher instanceof RegExp ? matcher.toString() : matcher;
}

function findSkuRate(skus, region, usageType, includePatterns, excludePatterns = []) {
  const sku = skus.find((candidate) => {
    const description = candidate.description ?? "";
    const matchesInclude = includePatterns.some((pattern) => pattern.test(description));
    const matchesExclude = excludePatterns.some((pattern) => pattern.test(description));
    const matchesUsageType = usageType ? candidate.category?.usageType === usageType : true;
    return matchesInclude && !matchesExclude && matchesUsageType && candidate.serviceRegions?.includes(region);
  });

  if (!sku) {
    throw new Error(`Missing Google Cloud storage SKU in ${region}.`);
  }

  return getSkuUnitPrice(sku);
}

function getSkuUnitPrice(sku) {
  const expression = sku.pricingInfo?.[0]?.pricingExpression;
  const tiers = expression?.tieredRates ?? [];
  const tier =
    tiers.find((candidate) => {
      const units = Number(candidate.unitPrice?.units ?? 0);
      const nanos = Number(candidate.unitPrice?.nanos ?? 0);
      return units > 0 || nanos > 0;
    }) ?? tiers[0];

  if (!tier?.unitPrice) {
    throw new Error(`Missing Google Cloud unit price for SKU ${sku.skuId}`);
  }

  return Number(tier.unitPrice.units ?? 0) + Number(tier.unitPrice.nanos ?? 0) / 1e9;
}
