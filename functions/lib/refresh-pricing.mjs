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
  const gcpMachineTypes = [...new Set(shapeMappings.flatMap((mapping) => [mapping.gcp, mapping.arm_gcp]).filter(Boolean))];
  const awsMachineTypes = [...new Set(shapeMappings.flatMap((mapping) => [mapping.aws, mapping.arm_aws]).filter(Boolean))];
  const azureMachineTypes = [...new Set(shapeMappings.flatMap((mapping) => [mapping.azure, mapping.arm_azure]).filter(Boolean))];

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
