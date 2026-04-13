import YAML from "yaml";
import gcpPricing from "@/data/generated/pricing/gcp.json";
import awsPricing from "@/data/generated/pricing/aws.json";
import azurePricing from "@/data/generated/pricing/azure.json";
import shapeMappingsRaw from "@/data/shape-mappings.yaml?raw";
import { cloudMeta, cloudOrder, sizeOrder, termOrder, type CloudSlug, type CommitmentTerm, type SizeSlug } from "@/lib/site";
import type { EstimateInput, EstimateResult, IsvEntry, PricingCache } from "@/lib/types";
import { buildEstimateCore, pickDefaultRegion } from "../../shared/estimate-core.mjs";

type ShapeMapping = {
  profile: string;
  vcpu: number;
  memory_gb: number;
  gcp: string;
  aws: string;
  azure: string;
};

const pricingByCloud = {
  gcp: gcpPricing as PricingCache,
  aws: awsPricing as PricingCache,
  azure: azurePricing as PricingCache
} satisfies Record<CloudSlug, PricingCache>;

const shapeMappings = loadShapeMappings();

function loadShapeMappings(): ShapeMapping[] {
  return YAML.parse(shapeMappingsRaw) as ShapeMapping[];
}

export function getPricingCache(cloud: CloudSlug) {
  return pricingByCloud[cloud];
}

export function getPricingSnapshotDate(cloud: CloudSlug) {
  return pricingByCloud[cloud].retrieved_at.slice(0, 10);
}

export function getRegionsForCloud(cloud: CloudSlug) {
  return Object.keys(pricingByCloud[cloud].regions);
}

export function getDefaultRegion(cloud: CloudSlug) {
  return pickDefaultRegion(pricingByCloud[cloud], cloudMeta[cloud].defaultRegion);
}

export function getDefaultSize(isv: IsvEntry): SizeSlug {
  return (sizeOrder.find((size) => Boolean(isv.data.sizes[size])) ?? "m") as SizeSlug;
}

export function normaliseState(isv: IsvEntry, state?: Partial<{ cloud: string; size: string; ha: boolean; term: string; region: string }>) {
  const cloud = (state?.cloud && state.cloud in cloudMeta ? state.cloud : "gcp") as CloudSlug;
  const size = (state?.size && sizeOrder.includes(state.size as SizeSlug) && isv.data.sizes[state.size as SizeSlug]
    ? state.size
    : getDefaultSize(isv)) as SizeSlug;
  const term = (state?.term && termOrder.includes(state.term as CommitmentTerm) ? state.term : "on-demand") as CommitmentTerm;
  const region = state?.region && getRegionsForCloud(cloud).includes(state.region) ? state.region : getDefaultRegion(cloud);

  return {
    cloud,
    size,
    ha: Boolean(state?.ha),
    term,
    region
  };
}

export function buildEstimate(input: EstimateInput): EstimateResult {
  const sizeTier = input.isv.data.sizes[input.size];

  if (!sizeTier) {
    throw new Error(`Size "${input.size}" is not defined for ${input.isv.data.slug}`);
  }

  const pricing = pricingByCloud[input.cloud];
  const regionPricing = pricing.regions[input.region];

  if (!regionPricing) {
    throw new Error(`Region "${input.region}" is not available for ${input.cloud}`);
  }
  const estimate = buildEstimateCore({
    sizeTier,
    cloud: input.cloud,
    term: input.term,
    ha: input.ha,
    regionPricing,
    shapeMappings,
    loadBalancerMonthlyUsdFallback: 0
  });

  return {
    ...estimate,
    pricingSnapshotDate: pricing.retrieved_at.slice(0, 10),
    citations: {
      refArchUrl: input.isv.data.ref_arch.source_url,
      refArchVersion: input.isv.data.ref_arch.version,
      refArchRetrievedDate: input.isv.data.ref_arch.retrieved_date,
      pricingRetrievedAt: pricing.retrieved_at
    }
  };
}

export function buildEstimateMatrix(isv: IsvEntry) {
  const matrix: Record<string, EstimateResult> = {};

  for (const cloud of cloudOrder) {
    for (const size of sizeOrder) {
      if (!isv.data.sizes[size]) {
        continue;
      }

      for (const ha of [false, true]) {
        for (const term of termOrder) {
          for (const region of getRegionsForCloud(cloud)) {
            const key = buildStateKey({ cloud, size, ha, term, region });
            matrix[key] = buildEstimate({
              isv,
              cloud,
              size,
              ha,
              term,
              region
            });
          }
        }
      }
    }
  }

  return matrix;
}

export function buildCompareMatrix(isv: IsvEntry) {
  const matrix: Record<string, { size: SizeSlug; ha: boolean; term: CommitmentTerm; regions: Record<CloudSlug, string>; estimates: Record<CloudSlug, EstimateResult> }> = {};

  for (const size of sizeOrder) {
    if (!isv.data.sizes[size]) {
      continue;
    }

    for (const ha of [false, true]) {
      for (const term of termOrder) {
        const regions = {
          gcp: getDefaultRegion("gcp"),
          aws: getDefaultRegion("aws"),
          azure: getDefaultRegion("azure")
        } satisfies Record<CloudSlug, string>;
        const key = buildCompareKey({ size, ha, term });
        matrix[key] = {
          size,
          ha,
          term,
          regions,
          estimates: {
            gcp: buildEstimate({ isv, cloud: "gcp", size, ha, term, region: regions.gcp }),
            aws: buildEstimate({ isv, cloud: "aws", size, ha, term, region: regions.aws }),
            azure: buildEstimate({ isv, cloud: "azure", size, ha, term, region: regions.azure })
          }
        };
      }
    }
  }

  return matrix;
}

export function buildStateKey(state: { cloud: CloudSlug; size: SizeSlug; ha: boolean; term: CommitmentTerm; region: string }) {
  return [state.cloud, state.size, state.ha ? "ha" : "noha", state.term, state.region].join(":");
}

export function buildCompareKey(state: { size: SizeSlug; ha: boolean; term: CommitmentTerm }) {
  return [state.size, state.ha ? "ha" : "noha", state.term].join(":");
}
