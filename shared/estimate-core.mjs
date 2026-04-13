export const termPriceKey = {
  "on-demand": "on_demand_hourly_usd",
  "1yr": "reserved_1yr_hourly_usd",
  "3yr": "reserved_3yr_hourly_usd"
};

export function buildEstimateCore({
  sizeTier,
  cloud,
  term,
  ha,
  regionPricing,
  shapeMappings,
  loadBalancerMonthlyUsdFallback = 0
}) {
  const components = [...sizeTier.components, ...(ha ? sizeTier.ha_components ?? [] : [])];
  const resolvedComponents = components.map((component) => {
    const mapping = pickShapeMapping(shapeMappings, component.vcpu, component.memory_gb);
    const instanceType = mapping[cloud];
    const unitHourly = regionPricing.compute[instanceType]?.[termPriceKey[term]];

    if (unitHourly == null) {
      throw new Error(`Missing compute price for ${instanceType}.`);
    }

    const monthlyCompute = unitHourly * 730 * component.count;
    const monthlyStorage =
      (component.storage_gb ?? 0) * getStorageRate(regionPricing.storage, component.storage_type) * component.count;

    return {
      role: component.role,
      count: component.count,
      vcpu: component.vcpu,
      memoryGb: component.memory_gb,
      storageGb: component.storage_gb ?? 0,
      storageType: component.storage_type,
      profile: mapping.profile,
      instanceType,
      unitHourly,
      monthlyCompute,
      monthlyStorage
    };
  });

  const computeTotal = sum(resolvedComponents.map((component) => component.monthlyCompute));
  const storageTotal = sum(resolvedComponents.map((component) => component.monthlyStorage));
  const loadBalancerCount = resolvedComponents
    .filter((component) => component.role.includes("load-balancer"))
    .reduce((total, component) => total + component.count, 0);
  const otherTotal =
    loadBalancerCount * (regionPricing.other?.load_balancer_monthly_usd ?? loadBalancerMonthlyUsdFallback);
  const monthlyTotal = computeTotal + storageTotal + otherTotal;

  return {
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
    computeTotal,
    storageTotal,
    otherTotal,
    sizeLabel: sizeTier.label,
    sizeDescription: sizeTier.range_description,
    refArchTier: sizeTier.ref_arch_tier,
    components: resolvedComponents
  };
}

export function pickDefaultRegion(pricingCache, fallbackRegion) {
  const regions = Object.entries(pricingCache.regions ?? {});

  if (regions.length === 0) {
    return fallbackRegion;
  }

  return (
    regions
      .map(([region, pricing]) => ({
        region,
        score: scoreRegion(pricing)
      }))
      .sort((left, right) => left.score - right.score)[0]?.region ?? fallbackRegion
  );
}

export function scoreRegion(pricing) {
  const computeRates = Object.values(pricing.compute ?? {}).map((value) => value.on_demand_hourly_usd);
  const averageCompute = computeRates.length > 0 ? sum(computeRates) / computeRates.length : Number.MAX_SAFE_INTEGER;
  return averageCompute + (pricing.storage?.ssd_gb_month_usd ?? 0) + (pricing.storage?.object_gb_month_usd ?? 0);
}

export function pickShapeMapping(shapeMappings, vcpu, memoryGb) {
  const sorted = [...shapeMappings].sort((left, right) => {
    const leftScore = Math.max(left.vcpu - vcpu, 0) + Math.max(left.memory_gb - memoryGb, 0);
    const rightScore = Math.max(right.vcpu - vcpu, 0) + Math.max(right.memory_gb - memoryGb, 0);
    return leftScore - rightScore;
  });

  return sorted.find((mapping) => mapping.vcpu >= vcpu && mapping.memory_gb >= memoryGb) ?? sorted.at(-1);
}

export function getStorageRate(storage, type) {
  if (type === "ssd") {
    return storage.ssd_gb_month_usd;
  }

  if (type === "hdd") {
    return storage.hdd_gb_month_usd;
  }

  if (type === "nvme") {
    return storage.nvme_gb_month_usd;
  }

  if (type === "object") {
    return storage.object_gb_month_usd;
  }

  return 0;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
