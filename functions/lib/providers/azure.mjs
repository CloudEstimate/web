import { logger } from "firebase-functions/v2";

const AZURE_BASE_URL = "https://prices.azure.com/api/retail/prices";

export async function fetchAzurePricing({ regions, machineTypes }) {
  return {
    cloud: "azure",
    retrieved_at: new Date().toISOString(),
    regions: Object.fromEntries(
      await Promise.all(
        regions.map(async (region) => [
          region,
          {
            compute: Object.fromEntries(
              await Promise.all(
                machineTypes.map(async (instanceType) => [
                  instanceType,
                  await getVmPricing(region, instanceType)
                ])
              )
            ),
            storage: {
              ssd_gb_month_usd: await getDiskRate(region, "Premium SSD"),
              hdd_gb_month_usd: await getDiskRate(region, "Standard HDD"),
              nvme_gb_month_usd: await getDiskRate(region, "Premium SSD v2"),
              object_gb_month_usd: await getObjectStorageRate(region)
            },
            other: {
              load_balancer_monthly_usd: region === "westus3" ? 19 : 18
            }
          }
        ])
      )
    )
  };
}

async function getVmPricing(region, instanceType) {
  const items = await fetchAzureItems(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and armSkuName eq '${instanceType}' and not contains(productName, 'Windows')`
  );
  // Keep the linux filter as a defensive guard for any edge cases that slip through the API filter.
  const linuxItems = items.filter((item) => isLinuxItem(item));
  const onDemand = linuxItems.find((item) => item.priceType === "Consumption");
  const reserved1yr = linuxItems.find((item) => item.priceType === "Reservation" && item.reservationTerm === "1 Year");
  const reserved3yr = linuxItems.find((item) => item.priceType === "Reservation" && item.reservationTerm === "3 Years");

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
    on_demand_hourly_usd: onDemand.unitPrice,
    reserved_1yr_hourly_usd: reserved1yrPrice,
    reserved_3yr_hourly_usd: reserved3yrPrice
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
  const linuxItems = items.filter((item) => isLinuxItem(item));
  const exactSkuItems = linuxItems.filter((item) => normalizeSkuName(item.armSkuName) === normalizeSkuName(instanceType));
  const candidates = exactSkuItems.length > 0 ? exactSkuItems : linuxItems;
  const onDemand = candidates.find((item) => item.priceType === "Consumption");

  if (!onDemand) {
    logger.warn(`Azure fallback query returned no on-demand price for ${instanceType} in ${region}. Trying regional fallback.`);
    return findRegionalVmPricingFallback(region, instanceType);
  }

  const reserved1yr = candidates.find((item) => item.priceType === "Reservation" && item.reservationTerm === "1 Year");
  const reserved3yr = candidates.find((item) => item.priceType === "Reservation" && item.reservationTerm === "3 Years");

  logger.warn(
    `Azure pricing fallback matched ${onDemand.armSkuName ?? "unknown"} for ${instanceType} in ${region}.`
  );

  return {
    on_demand_hourly_usd: onDemand.unitPrice,
    reserved_1yr_hourly_usd: reserved1yr?.unitPrice ?? onDemand.unitPrice,
    reserved_3yr_hourly_usd: reserved3yr?.unitPrice ?? reserved1yr?.unitPrice ?? onDemand.unitPrice
  };
}

async function findRegionalVmPricingFallback(region, instanceType) {
  const items = await fetchAzureItems(`serviceName eq 'Virtual Machines' and armRegionName eq '${region}'`);
  const linuxItems = items.filter((item) => isLinuxItem(item));
  const grouped = groupVmItemsBySku(linuxItems);
  const ranked = Array.from(grouped.entries())
    .map(([sku, skuItems]) => ({
      sku,
      skuItems,
      score: scoreSkuMatch(sku, instanceType)
    }))
    .filter((entry) => entry.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => left.score - right.score);

  const best = ranked.find((entry) => entry.skuItems.some((item) => item.priceType === "Consumption"));

  if (!best) {
    logger.warn(`Azure regional fallback found no usable VM pricing candidates for ${instanceType} in ${region}.`);
    return null;
  }

  const onDemand = best.skuItems.find((item) => item.priceType === "Consumption");
  const reserved1yr = best.skuItems.find((item) => item.priceType === "Reservation" && item.reservationTerm === "1 Year");
  const reserved3yr = best.skuItems.find((item) => item.priceType === "Reservation" && item.reservationTerm === "3 Years");

  logger.warn(`Azure regional fallback matched ${best.sku} for ${instanceType} in ${region}.`);

  return {
    on_demand_hourly_usd: onDemand.unitPrice,
    reserved_1yr_hourly_usd: reserved1yr?.unitPrice ?? onDemand.unitPrice,
    reserved_3yr_hourly_usd: reserved3yr?.unitPrice ?? reserved1yr?.unitPrice ?? onDemand.unitPrice
  };
}

async function getDiskRate(region, label) {
  const items = await fetchAzureItems(
    `serviceName eq 'Storage' and armRegionName eq '${region}'`
  );
  const diskItem = items.find(
    (item) =>
      item.productName?.includes(label) &&
      item.unitOfMeasure?.toLowerCase().includes("month") &&
      (item.meterName?.includes("Provisioned") || item.meterName?.includes("Disks") || item.meterName?.includes("LRS"))
  );

  if (!diskItem) {
    throw new Error(`Missing Azure disk pricing for ${label} in ${region}.`);
  }

  const denominator = inferDiskSizeGb(diskItem);
  return diskItem.unitPrice / denominator;
}

async function getObjectStorageRate(region) {
  const items = await fetchAzureItems(
    `serviceName eq 'Storage' and armRegionName eq '${region}'`
  );
  const objectItem = items.find(
    (item) =>
      item.productName?.includes("Blob Storage") &&
      item.skuName?.includes("Hot") &&
      item.unitOfMeasure?.toLowerCase().includes("gb/month")
  );

  if (!objectItem) {
    throw new Error(`Missing Azure object storage pricing in ${region}.`);
  }

  return objectItem.unitPrice;
}

async function fetchAzureItems(filter) {
  const items = [];
  let url = `${AZURE_BASE_URL}?$filter=${encodeURIComponent(filter)}`;

  while (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Azure pricing request failed: ${response.status} ${response.statusText}`);
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
  const match = candidates.match(/(\d{2,4})/);
  const diskSize = match ? Number(match[1]) : 1024;
  return diskSize >= 32 ? diskSize : 1024;
}
