import { logger } from "firebase-functions/v2";
import { providerTargets } from "../config.mjs";

export async function fetchAwsPricing({ regions, machineTypes }) {
  const ec2Offers = Object.fromEntries(await Promise.all(regions.map(async (region) => [region, await fetchOffer("AmazonEC2", region)])));
  const s3Offers = Object.fromEntries(await Promise.all(regions.map(async (region) => [region, await fetchOffer("AmazonS3", region)])));

  return {
    cloud: "aws",
    retrieved_at: new Date().toISOString(),
    regions: Object.fromEntries(
      regions.map((region) => [
        region,
        {
          compute: Object.fromEntries(
            machineTypes.map((instanceType) => [
              instanceType,
              getComputePricing(ec2Offers[region], region, instanceType)
            ])
          ),
          storage: {
            ssd_gb_month_usd: getStorageRate(ec2Offers[region], region, providerTargets.aws.storageProducts.ssd),
            hdd_gb_month_usd: getStorageRate(ec2Offers[region], region, providerTargets.aws.storageProducts.hdd),
            nvme_gb_month_usd: getStorageRate(ec2Offers[region], region, providerTargets.aws.storageProducts.nvme),
            object_gb_month_usd: getStorageRate(s3Offers[region], region, providerTargets.aws.storageProducts.object)
          },
          other: {
            load_balancer_monthly_usd: region === "us-west-2" ? 17 : 16
          }
        }
      ])
    )
  };
}

async function fetchOffer(serviceCode, region) {
  const regionIndexUrl = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${serviceCode}/current/region_index.json`;
  const index = await fetchJson(regionIndexUrl);
  const currentVersionUrl = index.regions?.[region]?.currentVersionUrl;
  const offerUrl = currentVersionUrl
    ? `https://pricing.us-east-1.amazonaws.com${currentVersionUrl}`
    : `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${serviceCode}/current/index.json`;
  const payload = await fetchJson(offerUrl);

  logger.info(`Fetched AWS ${serviceCode} pricing offer for ${region}.`);
  return payload;
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`AWS pricing request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function getComputePricing(offer, region, instanceType) {
  const product = findEc2Product(offer, region, instanceType);
  const sku = product.sku;

  return {
    on_demand_hourly_usd: extractOnDemandPrice(offer, sku),
    reserved_1yr_hourly_usd: extractReservedPrice(offer, sku, "1yr"),
    reserved_3yr_hourly_usd: extractReservedPrice(offer, sku, "3yr")
  };
}

function findEc2Product(offer, region, instanceType) {
  const location = providerTargets.aws.regionLabels[region];
  const products = Object.values(offer.products ?? {});
  const product = products.find(
    (candidate) =>
      candidate.attributes?.instanceType === instanceType &&
      candidate.attributes?.location === location &&
      candidate.attributes?.operatingSystem === "Linux" &&
      candidate.attributes?.tenancy === "Shared" &&
      candidate.attributes?.preInstalledSw === "NA" &&
      candidate.attributes?.capacitystatus === "Used"
  );

  if (!product) {
    throw new Error(`Missing AWS product for ${instanceType} in ${region}.`);
  }

  return product;
}

function getStorageRate(offer, region, config) {
  const location = providerTargets.aws.regionLabels[region];
  const products = Object.values(offer.products ?? {});
  const product = products.find(
    (candidate) => candidate.attributes?.location === location && config.matcher(candidate)
  );

  if (!product) {
    throw new Error(`Missing AWS storage product in ${region}.`);
  }

  return extractOnDemandPrice(offer, product.sku);
}

function extractOnDemandPrice(offer, sku) {
  const term = Object.values(offer.terms?.OnDemand?.[sku] ?? {})[0];
  const dimension = Object.values(term?.priceDimensions ?? {})[0];

  if (!dimension?.pricePerUnit?.USD) {
    throw new Error(`Missing AWS on-demand price for SKU ${sku}.`);
  }

  return Number(dimension.pricePerUnit.USD);
}

function extractReservedPrice(offer, sku, lease) {
  const term = Object.values(offer.terms?.Reserved?.[sku] ?? {}).find(
    (candidate) =>
      candidate.termAttributes?.LeaseContractLength === lease &&
      candidate.termAttributes?.PurchaseOption === "No Upfront" &&
      (!candidate.termAttributes?.OfferingClass || candidate.termAttributes?.OfferingClass === "standard")
  );
  const dimension = Object.values(term?.priceDimensions ?? {})[0];

  if (!dimension?.pricePerUnit?.USD) {
    throw new Error(`Missing AWS reserved price for SKU ${sku} (${lease}).`);
  }

  return Number(dimension.pricePerUnit.USD);
}
