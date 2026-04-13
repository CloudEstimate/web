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
    `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and armSkuName eq '${instanceType}'`
  );
  const linuxItems = items.filter((item) => isLinuxItem(item));
  const onDemand = linuxItems.find((item) => item.priceType === "Consumption");
  const reserved1yr = linuxItems.find((item) => item.priceType === "Reservation" && item.reservationTerm === "1 Year");
  const reserved3yr = linuxItems.find((item) => item.priceType === "Reservation" && item.reservationTerm === "3 Years");

  if (!onDemand || !reserved1yr || !reserved3yr) {
    throw new Error(`Missing Azure VM pricing for ${instanceType} in ${region}.`);
  }

  return {
    on_demand_hourly_usd: onDemand.unitPrice,
    reserved_1yr_hourly_usd: reserved1yr.unitPrice,
    reserved_3yr_hourly_usd: reserved3yr.unitPrice
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

function inferDiskSizeGb(item) {
  const candidates = [item.armSkuName, item.skuName, item.meterName]
    .filter(Boolean)
    .join(" ");
  const match = candidates.match(/(\d{2,4})/);
  const diskSize = match ? Number(match[1]) : 1024;
  return diskSize >= 32 ? diskSize : 1024;
}
