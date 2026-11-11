export const termPriceKey = {
  "on-demand": "on_demand_hourly_usd",
  "1yr": "reserved_1yr_hourly_usd",
  "3yr": "reserved_3yr_hourly_usd"
};

const armKeyByCloud = {
  gcp: "arm_gcp",
  aws: "arm_aws",
  azure: "arm_azure"
};

const armFamilyByCloud = {
  gcp: "Google Axion (C4A)",
  aws: "AWS Graviton (C7g/M8g/R8g)",
  azure: "Azure Cobalt 100 (Dv6/Ev6 Arm)"
};

export function isManagedLoadBalancerRole(role) {
  return role === "load-balancer" || role.endsWith("-load-balancer");
}

export function isObjectStorageRole(role, storageType) {
  return role === "object-storage" || (role.includes("object-storage") && storageType === "object" && role !== "object-storage-gateway");
}

export function buildEstimateCore({
  sizeTier,
  cloud,
  term,
  ha,
  regionPricing,
  shapeMappings,
  archSupport,
  loadBalancerMonthlyUsdFallback = 0
}) {
  const components = [...sizeTier.components, ...(ha ? sizeTier.ha_components ?? [] : [])];
  let armEligible = Array.isArray(archSupport) && archSupport.includes("arm64");
  let armComputeTotal = 0;
  const armInstances = new Set();

  const resolvedComponents = components.map((component) => {
    if (isManagedLoadBalancerRole(component.role)) {
      return {
        role: component.role,
        count: component.count,
        vcpu: 0,
        memoryGb: 0,
        provisionedVcpu: 0,
        provisionedMemoryGb: 0,
        gpu: 0,
        storageGb: 0,
        storageType: undefined,
        profile: "managed-lb",
        instanceType: "managed-lb",
        unitHourly: 0,
        onDemandMonthlyCompute: 0,
        monthlyCompute: 0,
        monthlyStorage: 0
      };
    }

    if (isObjectStorageRole(component.role, component.storage_type)) {
      const storageType = component.storage_type ?? "object";
      const monthlyStorage =
        (component.storage_gb ?? 0) * getStorageRate(regionPricing.storage, storageType) * component.count;

      return {
        role: component.role,
        count: component.count,
        vcpu: 0,
        memoryGb: 0,
        provisionedVcpu: 0,
        provisionedMemoryGb: 0,
        gpu: 0,
        storageGb: component.storage_gb ?? 0,
        storageType,
        profile: "object-storage",
        instanceType: "object-bucket",
        unitHourly: 0,
        onDemandMonthlyCompute: 0,
        monthlyCompute: 0,
        monthlyStorage
      };
    }

    const mapping = pickShapeMapping(shapeMappings, component.vcpu, component.memory_gb, component.gpu ?? 0);
    const instanceType = mapping[cloud];
    const priceRecord = regionPricing.compute[instanceType];
    const unitHourly = priceRecord?.[termPriceKey[term]];
    const onDemandHourly = priceRecord?.on_demand_hourly_usd ?? unitHourly;

    if (unitHourly == null) {
      throw new Error(`Missing compute price for ${instanceType}.`);
    }

    const monthlyCompute = unitHourly * 730 * component.count;
    const onDemandMonthlyCompute = (onDemandHourly ?? unitHourly) * 730 * component.count;
    const monthlyStorage =
      (component.storage_gb ?? 0) * getStorageRate(regionPricing.storage, component.storage_type) * component.count;

    if (armEligible) {
      const armInstance = mapping[armKeyByCloud[cloud]];
      const armHourly = armInstance ? regionPricing.compute[armInstance]?.[termPriceKey[term]] : null;
      if (armInstance && armHourly != null) {
        armComputeTotal += armHourly * 730 * component.count;
        armInstances.add(armInstance);
      } else {
        armEligible = false;
      }
    }

    return {
      role: component.role,
      count: component.count,
      vcpu: component.vcpu,
      memoryGb: component.memory_gb,
      provisionedVcpu: mapping.vcpu,
      provisionedMemoryGb: mapping.memory_gb,
      gpu: mapping.gpu ?? 0,
      storageGb: component.storage_gb ?? 0,
      storageType: component.storage_type,
      profile: mapping.profile,
      instanceType,
      unitHourly,
      onDemandMonthlyCompute,
      monthlyCompute,
      monthlyStorage
    };
  });

  const computeTotal = sum(resolvedComponents.map((component) => component.monthlyCompute));
  const onDemandComputeTotal = sum(resolvedComponents.map((component) => component.onDemandMonthlyCompute));
  const storageTotal = sum(resolvedComponents.map((component) => component.monthlyStorage));
  const loadBalancerCount = resolvedComponents
    .filter((component) => isManagedLoadBalancerRole(component.role))
    .reduce((total, component) => total + component.count, 0);
  const otherTotal =
    loadBalancerCount * (regionPricing.other?.load_balancer_monthly_usd ?? loadBalancerMonthlyUsdFallback);
  const monthlyTotal = computeTotal + storageTotal + otherTotal;

  let armAlternative = null;
  if (armEligible && computeTotal > 0 && armInstances.size > 0) {
    const armMonthlyTotal = armComputeTotal + storageTotal + otherTotal;
    const savingsUsd = monthlyTotal - armMonthlyTotal;
    if (savingsUsd > 1) {
      armAlternative = {
        archFamily: armFamilyByCloud[cloud],
        monthlyTotal: armMonthlyTotal,
        computeTotal: armComputeTotal,
        savingsMonthlyUsd: savingsUsd,
        savingsPercent: (savingsUsd / monthlyTotal) * 100,
        instanceTypes: [...armInstances]
      };
    }
  }

  return {
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
    computeTotal,
    onDemandComputeTotal,
    storageTotal,
    otherTotal,
    haAddsComponents: (sizeTier.ha_components ?? []).length > 0,
    armAlternative,
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

export function pickShapeMapping(shapeMappings, vcpu, memoryGb, gpu = 0) {
  const requiredGpu = gpu ?? 0;
  const pool = shapeMappings.filter((mapping) =>
    requiredGpu > 0 ? (mapping.gpu ?? 0) >= requiredGpu : (mapping.gpu ?? 0) === 0
  );
  const candidates = pool.length > 0 ? pool : shapeMappings;

  const sorted = [...candidates].sort((left, right) => {
    const leftGpuPenalty = Math.max((left.gpu ?? 0) - requiredGpu, 0) * 100;
    const rightGpuPenalty = Math.max((right.gpu ?? 0) - requiredGpu, 0) * 100;
    const leftScore = leftGpuPenalty + Math.max(left.vcpu - vcpu, 0) * 2 + Math.max(left.memory_gb - memoryGb, 0);
    const rightScore = rightGpuPenalty + Math.max(right.vcpu - vcpu, 0) * 2 + Math.max(right.memory_gb - memoryGb, 0);
    return leftScore - rightScore;
  });

  return (
    sorted.find(
      (mapping) => mapping.vcpu >= vcpu && mapping.memory_gb >= memoryGb && (mapping.gpu ?? 0) >= requiredGpu
    ) ?? sorted.at(-1)
  );
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
