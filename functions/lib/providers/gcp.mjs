import { GoogleAuth } from "google-auth-library";
import { logger } from "firebase-functions/v2";
import { providerTargets } from "../config.mjs";
import { getShapeMappings } from "../runtime-data.mjs";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-billing.readonly"]
});

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
  const machineSpecs = Object.fromEntries(
    shapeMappings.map((mapping) => [
      mapping.gcp,
      {
        vcpu: mapping.vcpu,
        memoryGb: mapping.memory_gb
      }
    ])
  );

  return {
    cloud: "gcp",
    retrieved_at: new Date().toISOString(),
    regions: Object.fromEntries(
      regions.map((region) => {
        const regionCompute = Object.fromEntries(
          machineTypes.map((machineType) => {
            const spec = machineSpecs[machineType];
            const rates = {
              on_demand_hourly_usd:
                getComputeRate(computeSkus, region, "OnDemand", "N2 Predefined Instance Core", spec.vcpu) +
                getComputeRate(computeSkus, region, "OnDemand", "N2 Predefined Instance Ram", spec.memoryGb),
              reserved_1yr_hourly_usd:
                getComputeRate(computeSkus, region, "Commit1Yr", "N2 Predefined Instance Core", spec.vcpu) +
                getComputeRate(computeSkus, region, "Commit1Yr", "N2 Predefined Instance Ram", spec.memoryGb),
              reserved_3yr_hourly_usd:
                getComputeRate(computeSkus, region, "Commit3Yr", "N2 Predefined Instance Core", spec.vcpu) +
                getComputeRate(computeSkus, region, "Commit3Yr", "N2 Predefined Instance Ram", spec.memoryGb)
            };

            return [machineType, rates];
          })
        );

        return [
          region,
          {
            compute: regionCompute,
            storage: {
              ssd_gb_month_usd: findSkuRate(computeSkus, region, null, providerTargets.gcp.storagePatterns.ssd.include, providerTargets.gcp.storagePatterns.ssd.exclude),
              hdd_gb_month_usd: findSkuRate(computeSkus, region, null, providerTargets.gcp.storagePatterns.hdd.include, providerTargets.gcp.storagePatterns.hdd.exclude),
              nvme_gb_month_usd: findSkuRate(computeSkus, region, null, providerTargets.gcp.storagePatterns.nvme.include, providerTargets.gcp.storagePatterns.nvme.exclude),
              object_gb_month_usd: findSkuRate(storageSkus, region, null, providerTargets.gcp.storagePatterns.object.include, providerTargets.gcp.storagePatterns.object.exclude)
            },
            other: {
              load_balancer_monthly_usd: 18
            }
          }
        ];
      })
    )
  };
}

async function getGoogleHeaders() {
  const client = await auth.getClient();
  return client.getRequestHeaders();
}

async function fetchGoogleJson(url, headers) {
  const response = await fetch(url, {
    headers
  });

  if (!response.ok) {
    throw new Error(`Google Cloud Billing request failed: ${response.status} ${response.statusText}`);
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

function getComputeRate(skus, region, usageType, descriptionPrefix, multiplier) {
  const sku = skus.find(
    (candidate) =>
      candidate.description?.includes(descriptionPrefix) &&
      candidate.category?.usageType === usageType &&
      candidate.serviceRegions?.includes(region)
  );

  if (!sku) {
    throw new Error(`Missing Google Cloud SKU for ${descriptionPrefix} in ${region} (${usageType}).`);
  }

  return getSkuUnitPrice(sku) * multiplier;
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
  const tier = expression?.tieredRates?.[0];

  if (!tier?.unitPrice) {
    throw new Error(`Missing Google Cloud unit price for SKU ${sku.skuId}`);
  }

  const raw = Number(tier.unitPrice.units ?? 0) + Number(tier.unitPrice.nanos ?? 0) / 1e9;
  return expression?.baseUnitConversionFactor ? raw / expression.baseUnitConversionFactor : raw;
}
