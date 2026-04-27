import { logger } from "firebase-functions/v2";

const AZURE_BASE_URL = "https://prices.azure.com/api/retail/prices";
const HOURS_PER_MONTH = 365 * 24 / 12;

export async function fetchAzurePricing({ regions, machineTypes }) {
  return {
    cloud: "azure",
    retrieved_at: new Date().toISOString(),
    regions: Object.fromEntries(
      await Promise.all(regions.map(async (region) => [region, await getRegionPricing(region, machineTypes)]))
    )
  };
}

async function getRegionPricing(region, machineTypes) {
  const [compute, storageItems] = await Promise.all([
    Object.fromEntries(
      await Promise.all(
        machineTypes.map(async (instanceType) => [
          instanceType,
          await getVmPricing(region, instanceType)
        ])
      )
    ),
    fetchAzureItems(`serviceName eq 'Storage' and armRegionName eq '${region}'`)
  ]);

  return {
    compute,
    storage: {
      ssd_gb_month_usd: getDiskRate(storageItems, region, "Premium SSD"),
      hdd_gb_month_usd: getDiskRate(storageItems, region, "Standard HDD"),
      nvme_gb_month_usd: getDiskRate(storageItems, region, "Premium SSD v2"),
      object_gb_month_usd: getObjectStorageRate(storageItems, region)
    },
    other: {
      load_balancer_monthly_usd: region === "westus3" ? 19 : 18
    }
  };
}

async function getVmPricing(region, instanceType) {
  const items = await fetchAzureItems(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and armSkuName eq '${instanceType}'`
  );
  // Keep the linux filter as a defensive guard for any edge cases that slip through the API filter.
  const candidates = items.filter((item) => isLinuxItem(item) && isStandardVmPriceItem(item, instanceType));
  const onDemand = candidates.find((item) => getAzurePriceType(item) === "Consumption");
  const reserved1yr = candidates.find((item) => getAzurePriceType(item) === "Reservation" && item.reservationTerm === "1 Year");
  const reserved3yr = candidates.find((item) => getAzurePriceType(item) === "Reservation" && item.reservationTerm === "3 Years");

  if (!onDemand) {
    const fallback = await findVmPricingFallback(region, instanceType);

    if (fallback) {
      return fallback;
    }

    throw new Error(`Missing Azure VM pricing for ${instanceType} in ${region}.`);
  }

  const reserved1yrPrice = reserved1yr?.unitPrice ?? onDemand.unitPrice;
  const reserved3yrPrice = reserved3yr?.unitPrice ?? reserved1yrPrice;

  if (!reserved1yr) {
    logger.warn(`Missing Azure 1-year reservation price for ${instanceType} in ${region}; falling back to on-demand.`);
  }

  if (!reserved3yr) {
    logger.warn(`Missing Azure 3-year reservation price for ${instanceType} in ${region}; falling back to ${reserved1yr ? "1-year reservation" : "on-demand"}.`);
  }

  return {
    on_demand_hourly_usd: getVmHourlyRate(onDemand),
    reserved_1yr_hourly_usd: getVmHourlyRate(reserved1yr) ?? reserved1yrPrice,
    reserved_3yr_hourly_usd: getVmHourlyRate(reserved3yr) ?? reserved3yrPrice
  };
}

async function findVmPricingFallback(region, instanceType) {
  const familyPrefix = instanceType.match(/^(Standard_[A-Z]+\d+)/i)?.[1];

  if (!familyPrefix) {
    return findRegionalVmPricingFallback(region, instanceType);
  }

  const items = await fetchAzureItems(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and contains(armSkuName, '${familyPrefix}')`
  );
  const linuxItems = items.filter((item) => isLinuxItem(item) && isStandardVmPriceItem(item));
  const exactSkuItems = linuxItems.filter((item) => isSameSku(item, instanceType));
  const candidates = exactSkuItems.length > 0 ? exactSkuItems : linuxItems;
  const onDemand = candidates.find((item) => getAzurePriceType(item) === "Consumption");

  if (!onDemand) {
    logger.warn(`Azure fallback query returned no on-demand price for ${instanceType} in ${region}. Trying regional fallback.`);
    return findRegionalVmPricingFallback(region, instanceType);
  }

  const reserved1yr = candidates.find((item) => getAzurePriceType(item) === "Reservation" && item.reservationTerm === "1 Year");
  const reserved3yr = candidates.find((item) => getAzurePriceType(item) === "Reservation" && item.reservationTerm === "3 Years");

  logger.warn(
    `Azure pricing fallback matched ${onDemand.armSkuName ?? "unknown"} for ${instanceType} in ${region}.`
  );

  return {
    on_demand_hourly_usd: getVmHourlyRate(onDemand),
    reserved_1yr_hourly_usd: getVmHourlyRate(reserved1yr) ?? getVmHourlyRate(onDemand),
    reserved_3yr_hourly_usd: getVmHourlyRate(reserved3yr) ?? getVmHourlyRate(reserved1yr) ?? getVmHourlyRate(onDemand)
  };
}

async function findRegionalVmPricingFallback(region, instanceType) {
  const items = await fetchAzureItems(`serviceName eq 'Virtual Machines' and armRegionName eq '${region}'`);
  const linuxItems = items.filter((item) => isLinuxItem(item) && isStandardVmPriceItem(item));
  const grouped = groupVmItemsBySku(linuxItems);
  const ranked = Array.from(grouped.entries())
    .map(([sku, skuItems]) => ({
      sku,
      skuItems,
      score: scoreSkuMatch(sku, instanceType)
    }))
    .filter((entry) => entry.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.score - right.score);

  const best = ranked.find((entry) => entry.skuItems.some((item) => getAzurePriceType(item) === "Consumption"));

  if (!best) {
    logger.warn(`Azure regional fallback found no usable VM pricing candidates for ${instanceType} in ${region}.`);
    return null;
  }

  const onDemand = best.skuItems.find((item) => getAzurePriceType(item) === "Consumption");
  const reserved1yr = best.skuItems.find((item) => getAzurePriceType(item) === "Reservation" && item.reservationTerm === "1 Year");
  const reserved3yr = best.skuItems.find((item) => getAzurePriceType(item) === "Reservation" && item.reservationTerm === "3 Years");

  logger.warn(`Azure regional fallback matched ${best.sku} for ${instanceType} in ${region}.`);

  return {
    on_demand_hourly_usd: getVmHourlyRate(onDemand),
    reserved_1yr_hourly_usd: getVmHourlyRate(reserved1yr) ?? getVmHourlyRate(onDemand),
    reserved_3yr_hourly_usd: getVmHourlyRate(reserved3yr) ?? getVmHourlyRate(reserved1yr) ?? getVmHourlyRate(onDemand)
  };
}

function getDiskRate(items, region, label) {
  const diskItem = findDiskItem(items, label);

  if (!diskItem) {
    throw new Error(`Missing Azure disk pricing for ${label} in ${region}.`);
  }

  return getStorageGbMonthRate(diskItem);
}

function getObjectStorageRate(items, region) {
  const objectItem = items.find(
    (item) =>
      item.productName === "Blob Storage" &&
      item.skuName === "Hot LRS" &&
      item.meterName === "Hot LRS Data Stored" &&
      getAzurePriceType(item) === "Consumption" &&
      Number(item.tierMinimumUnits ?? 0) === 0 &&
      item.unitOfMeasure?.toLowerCase().includes("gb/month")
  );

  if (!objectItem) {
    throw new Error(`Missing Azure object storage pricing in ${region}.`);
  }

  return objectItem.unitPrice;
}

function findDiskItem(items, label) {
  if (label === "Premium SSD v2") {
    return items.find(
      (item) =>
        item.productName === "Azure Premium SSD v2" &&
        item.skuName === "Premium LRS" &&
        item.meterName === "Premium LRS Provisioned Capacity" &&
        getAzurePriceType(item) === "Consumption" &&
        Number(item.tierMinimumUnits ?? 0) === 0
    );
  }

  if (label === "Premium SSD") {
    return findManagedDiskItem(items, "Premium SSD Managed Disks", "P30 LRS", "P30 LRS Disk");
  }

  if (label === "Standard HDD") {
    return findManagedDiskItem(items, "Standard HDD Managed Disks", "S30 LRS", "S30 LRS Disk");
  }

  return null;
}

function findManagedDiskItem(items, productName, skuName, meterName) {
  return items.find(
    (item) =>
      item.productName === productName &&
      item.skuName === skuName &&
      item.meterName === meterName &&
      getAzurePriceType(item) === "Consumption" &&
      Number(item.tierMinimumUnits ?? 0) === 0
  );
}

async function fetchAzureItems(filter) {
  const items = [];
  let url = `${AZURE_BASE_URL}?$filter=${encodeURIComponent(filter)}`;

  while (url) {
    const response = await fetch(url);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Azure pricing request failed: ${response.status} ${response.statusText} for filter "${filter}". ${errorBody}`
      );
    }

    const payload = await response.json();
    items.push(...(payload.Items ?? []));
    url = payload.NextPageLink ?? null;
  }

  logger.info(`Fetched ${items.length} Azure retail price items for filter ${filter}.`);
  return items;
}

function isLinuxItem(item) {
  const productName = item.productName ?? "";
  const meterName = item.meterName ?? "";
  return !productName.includes("Windows") && !meterName.includes("Windows");
}

function isStandardVmPriceItem(item, targetSku = null) {
  const priceType = getAzurePriceType(item);
  const usageLabel = `${item.skuName ?? ""} ${item.meterName ?? ""}`;

  if (priceType === "DevTestConsumption" || /\b(Spot|Low Priority)\b/i.test(usageLabel)) {
    return false;
  }

  return targetSku ? isSameSku(item, targetSku) : true;
}

function isSameSku(item, targetSku) {
  const normalizedTarget = normalizeSkuName(targetSku);
  return [item.armSkuName, item.skuName].some((value) => normalizeSkuName(value) === normalizedTarget);
}

function getAzurePriceType(item) {
  return item.priceType ?? item.type;
}

function getVmHourlyRate(item) {
  if (!item) {
    return null;
  }

  if (getAzurePriceType(item) !== "Reservation") {
    return item.unitPrice;
  }

  return item.unitPrice / getReservationTermHours(item.reservationTerm);
}

function getReservationTermHours(reservationTerm) {
  const years = Number(String(reservationTerm ?? "").match(/\d+/)?.[0] ?? 1);
  return years * 365 * 24;
}

function getStorageGbMonthRate(item) {
  const unitOfMeasure = item.unitOfMeasure?.toLowerCase() ?? "";

  if (unitOfMeasure.includes("gib/hour") || unitOfMeasure.includes("gb/hour")) {
    return item.unitPrice * HOURS_PER_MONTH;
  }

  if (unitOfMeasure.includes("gb/month") || unitOfMeasure.includes("gib/month")) {
    return item.unitPrice;
  }

  if (unitOfMeasure.includes("month")) {
    return item.unitPrice / inferDiskSizeGb(item);
  }

  throw new Error(`Unsupported Azure storage unit of measure "${item.unitOfMeasure}" for ${item.meterName}.`);
}

function normalizeSkuName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");
}

function groupVmItemsBySku(items) {
  const groups = new Map();

  for (const item of items) {
    const sku = item.armSkuName ?? item.skuName;

    if (!sku) {
      continue;
    }

    const existing = groups.get(sku) ?? [];
    existing.push(item);
    groups.set(sku, existing);
  }

  return groups;
}

function scoreSkuMatch(candidateSku, targetSku) {
  const candidate = parseSku(candidateSku);
  const target = parseSku(targetSku);

  if (!candidate || !target) {
    return Number.POSITIVE_INFINITY;
  }

  if (candidate.family !== target.family) {
    return Number.POSITIVE_INFINITY;
  }

  const versionPenalty = candidate.version === target.version ? 0 : 1000;
  const variantPenalty = candidate.variant === target.variant ? 0 : 100;
  const sizePenalty = Math.abs(candidate.size - target.size);
  return versionPenalty + variantPenalty + sizePenalty;
}

function parseSku(value) {
  const normalized = String(value ?? "").trim();
  const match = normalized.match(/^Standard_([A-Za-z]+)(\d+)([A-Za-z]*)_v(\d+)$/i);

  if (!match) {
    return null;
  }

  return {
    family: match[1].toLowerCase(),
    size: Number(match[2]),
    variant: match[3].toLowerCase(),
    version: Number(match[4])
  };
}

function inferDiskSizeGb(item) {
  const candidates = [item.armSkuName, item.skuName, item.meterName]
    .filter(Boolean)
    .join(" ");
  const match = candidates.match(/\b[PS](\d{1,2})\b/i);
  const diskSizeByTier = {
    1: 4,
    2: 8,
    3: 16,
    4: 32,
    6: 64,
    10: 128,
    15: 256,
    20: 512,
    30: 1024,
    40: 2048,
    50: 4096,
    60: 8192,
    70: 16384,
    80: 32768
  };

  return match ? diskSizeByTier[Number(match[1])] ?? 1024 : 1024;
}
