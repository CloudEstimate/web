import { cloudMeta, cloudOrder, sizeOrder } from "./config.mjs";
import { getShapeMappings } from "./runtime-data.mjs";
import { buildEstimateCore, pickDefaultRegion } from "../generated/estimate-core.mjs";

const shapeMappings = getShapeMappings();

export function buildEstimate({ isv, cloud, size, ha, term, region, pricingByCloud }) {
  const sizeTier = isv.sizes[size];

  if (!sizeTier) {
    throw new Error(`Missing size tier ${size} for ${isv.slug}`);
  }

  const pricing = pricingByCloud[cloud];
  const regionPricing = pricing.regions[region];

  if (!regionPricing) {
    throw new Error(`Missing region ${region} for ${cloud}`);
  }

  return buildEstimateCore({
    sizeTier,
    cloud,
    term,
    ha,
    regionPricing,
    shapeMappings,
    loadBalancerMonthlyUsdFallback: cloudMeta[cloud].loadBalancerMonthlyUsd
  });
}

export function buildEstimateTuples(isv, pricingByCloud) {
  const tuples = [];

  for (const cloud of cloudOrder) {
    for (const size of sizeOrder) {
      if (!isv.sizes[size]) {
        continue;
      }

      for (const ha of [false, true]) {
        for (const term of ["on-demand", "1yr", "3yr"]) {
          const region = getDefaultRegion(cloud, pricingByCloud[cloud]);
          tuples.push({
            cloud,
            size,
            ha,
            term,
            region,
            estimate: buildEstimate({
              isv,
              cloud,
              size,
              ha,
              term,
              region,
              pricingByCloud
            })
          });
        }
      }
    }
  }

  return tuples;
}

export function buildCompareTuples(isv, pricingByCloud) {
  const tuples = [];

  for (const size of sizeOrder) {
    if (!isv.sizes[size]) {
      continue;
    }

    for (const ha of [false, true]) {
      for (const term of ["on-demand", "1yr", "3yr"]) {
        const estimates = {};

        for (const cloud of cloudOrder) {
          const region = getDefaultRegion(cloud, pricingByCloud[cloud]);
          estimates[cloud] = {
            region,
            estimate: buildEstimate({
              isv,
              cloud,
              size,
              ha,
              term,
              region,
              pricingByCloud
            })
          };
        }

        tuples.push({
          size,
          ha,
          term,
          estimates
        });
      }
    }
  }

  return tuples;
}

export function getDefaultRegion(cloud, pricing) {
  return pickDefaultRegion(pricing, cloudMeta[cloud].defaultRegion);
}
