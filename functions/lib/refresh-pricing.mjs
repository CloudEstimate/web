import { logger } from "firebase-functions/v2";
import { providerTargets } from "./config.mjs";
import { fetchAwsPricing } from "./providers/aws.mjs";
import { fetchAzurePricing } from "./providers/azure.mjs";
import { fetchGcpPricing } from "./providers/gcp.mjs";
import { getCacheBucket, writeJson } from "./storage.mjs";
import { getShapeMappings } from "./runtime-data.mjs";

export async function refreshPricingCaches() {
  const bucket = getCacheBucket();
  const shapeMappings = getShapeMappings();
  const today = new Date().toISOString().slice(0, 10);
  const gcpMachineTypes = [...new Set(shapeMappings.map((mapping) => mapping.gcp))];
  const awsMachineTypes = [...new Set(shapeMappings.map((mapping) => mapping.aws))];
  const azureMachineTypes = [...new Set(shapeMappings.map((mapping) => mapping.azure))];

  const providers = [
    ["gcp", () => fetchGcpPricing({ regions: providerTargets.gcp.regions, machineTypes: gcpMachineTypes })],
    ["aws", () => fetchAwsPricing({ regions: providerTargets.aws.regions, machineTypes: awsMachineTypes })],
    ["azure", () => fetchAzurePricing({ regions: providerTargets.azure.regions, machineTypes: azureMachineTypes })]
  ];

  for (const [cloud, fetchPricing] of providers) {
    const payload = await fetchPricing();
    await writeJson(bucket.file(`pricing/${cloud}-${today}.json`), payload);
    await writeJson(bucket.file(`site-build/pricing-${cloud}.json`), payload);
    logger.info(`Wrote pricing cache for ${cloud}.`);
  }
}
