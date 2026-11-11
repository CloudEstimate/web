import { logger } from "firebase-functions/v2";

const AZURE_BASE_URL = "https://prices.azure.com/api/retail/prices";
const HOURS_PER_MONTH = (365 * 24) / 12;
const BATCH_SIZE = 8;

const lbMonthlyByRegion = {
  eastus: 18,
  westus3: 19,
  westeurope: 19,
  southeastasia: 19
};

export async function fetchAzurePricing({ regions, machineTypes }) {
  const regionEntries = [];
  for (const region of regions) {
    regionEntries.push([region, await getRegionPricing(region, machineTypes)]);
  }

  return {
    cloud: "azure",
    retrieved_at: new Date().toISOString(),
    regions: Object.fromEntries(regionEntries)
  };
}

async function getRegionPricing(region, machineTypes) {
  const [compute, storageItems] = await Promise.all([
    getRegionComputePricing(region, machineTypes),
    fetchAzureItems(`serviceName eq 'Storage' and armRegionName eq '${region}'`)
  ]);

  return {
    compute,
    storage: {
      ssd_gb_month_usd: getDiskRate(storageItems, region, "Standard SSD"),
      hdd_gb_month_usd: getDiskRate(storageItems, region, "Standard HDD"),
      nvme_gb_month_usd: getDiskRate(storageItems, region, "Premium SSD"),
      object_gb_month_usd: getObjectStorageRate(storageItems, region)
    },
    other: {
      load_balancer_monthly_usd: lbMonthlyByRegion[region] ?? 18
    }
  };
}

async function getRegionComputePricing(region, machineTypes) {
  const compute = {};
  const chunks = [];
  for (let i = 0; i < machineTypes.length; i += BATCH_SIZE) {
    chunks.push(machineTypes.slice(i, i + BATCH_SIZE));
  }

  for (const chunk of chunks) {
    const orClause = chunk.map((sku) => `armSkuName eq '${sku}'`).join(" or ");
    const batchItems = await fetchAzureItems(
      `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and (${orClause})`
    );

    for (const instanceType of chunk) {
      const candidates = batchItems.filter(
        (item) => isLinuxItem(item) && isStandardVmPriceItem(item, instanceType)
      );
      const extracted = extractVmRates(candidates, instanceType, region, false);
      if (extracted) {
        compute[instanceType] = extracted;
      } else {
        compute[instanceType] = await getVmPricing(region, instanceType);
      }
    }
  }

  return compute;
}

function extractVmRates(candidates, instanceType, region, warnMissing) {
  const onDemand = candidates.find((item) => getAzurePriceType(item) === "Consumption");
  const reserved1yr = candidates.find(
    (item) => getAzurePriceType(item) === "Reservation" && item.reservationTerm === "1 Year"
  );
  const reserved3yr = candidates.find(
    (item) => getAzurePriceType(item) === "Reservation" && item.reservationTerm === "3 Years"
  );

  if (!onDemand) {
    return null;
  }

  const onDemandHourly = getVmHourlyRate(onDemand);
  const reserved1yrHourly = getVmHourlyRate(reserved1yr) ?? onDemandHourly;
  const reserved3yrHourly = getVmHourlyRate(reserved3yr) ?? reserved1yrHourly;

  if (warnMissing && !reserved1yr) {
    logger.warn(`Missing Azure 1-year reservation price for ${instanceType} in ${region}; falling back to on-demand.`);
  }
  if (warnMissing && !reserved3yr) {
    logger.warn(
      `Missing Azure 3-year reservation price for ${instanceType} in ${region}; falling back to ${
        reserved1yr ? "1-year reservation" : "on-demand"
      }.`
    );
  }

  return {
    on_demand_hourly_usd: onDemandHourly,
    reserved_1yr_hourly_usd: reserved1yrHourly,
    reserved_3yr_hourly_usd: reserved3yrHourly
  };
}

async function getVmPricing(region, instanceType) {
  const items = await fetchAzureItems(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and armSkuName eq '${instanceType}'`
  );
  const candidates = items.filter((item) => isLinuxItem(item) && isStandardVmPriceItem(item, instanceType));
  const extracted = extractVmRates(candidates, instanceType, region, true);

  if (extracted) {
    return extracted;
  }

  const fallback = await findVmPricingFallback(region, instanceType);
  if (fallback) {
    return fallback;
  }

  throw new Error(`Missing Azure VM pricing for ${instanceType} in ${region}.`);
}

async function findVmPricingFallback(region, instanceType) {
  const familyPrefix = instanceType.match(/^(Standard_[A-Z]+\d+)/i)?.[1];

  if (!familyPrefix) {
    return null;
  }

  const items = await fetchAzureItems(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and contains(armSkuName, '${familyPrefix}')`
  );
  const linuxItems = items.filter((item) => isLinuxItem(item) && isStandardVmPriceItem(item));
  const exactSkuItems = linuxItems.filter((item) => isSameSku(item, instanceType));
  const candidates = exactSkuItems.length > 0 ? exactSkuItems : linuxItems;
  return extractVmRates(candidates, instanceType, region, true);
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
  if (label === "Standard SSD") {
    return findManagedDiskItem(items, "Standard SSD Managed Disks", "E30 LRS", "E30 LRS Disk");
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

const AZURE_MAX_ATTEMPTS = 6;
const AZURE_BASE_DELAY_MS = 2000;
const AZURE_MAX_DELAY_MS = 60000;

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function getRetryDelayMs(response, attempt) {
  const retryAfter = Number(response?.headers?.get("retry-after"));

  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, AZURE_MAX_DELAY_MS);
  }

  const ceiling = Math.min(AZURE_BASE_DELAY_MS * 2 ** (attempt - 1), AZURE_MAX_DELAY_MS);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAzureWithRetry(url, filter) {
  for (let attempt = 1; ; attempt += 1) {
    let response;

    try {
      response = await fetch(url);
    } catch (error) {
      if (attempt >= AZURE_MAX_ATTEMPTS) {
        throw error;
      }

      const delayMs = getRetryDelayMs(null, attempt);
      logger.warn(
        `Azure pricing request errored (${error.message}) for filter ${filter}; retrying in ${delayMs}ms (attempt ${attempt}/${AZURE_MAX_ATTEMPTS}).`
      );
      await sleep(delayMs);
      continue;
    }

    if (response.ok || !isRetryableStatus(response.status) || attempt >= AZURE_MAX_ATTEMPTS) {
      return response;
    }

    const delayMs = getRetryDelayMs(response, attempt);
    logger.warn(
      `Azure pricing request returned ${response.status} for filter ${filter}; retrying in ${delayMs}ms (attempt ${attempt}/${AZURE_MAX_ATTEMPTS}).`
    );
    await response.body?.cancel();
    await sleep(delayMs);
  }
}

async function fetchAzureItems(filter) {
  const items = [];
  let url = `${AZURE_BASE_URL}?$filter=${encodeURIComponent(filter)}`;

  while (url) {
    const response = await fetchAzureWithRetry(url, filter);
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

function inferDiskSizeGb(item) {
  const candidates = [item.armSkuName, item.skuName, item.meterName].filter(Boolean).join(" ");
  const match = candidates.match(/\b[PSE](\d{1,2})\b/i);
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
