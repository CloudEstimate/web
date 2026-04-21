import fs from "node:fs/promises";
import path from "node:path";
import { providerTargets } from "../lib/config.mjs";
import { fetchAwsPricing } from "../lib/providers/aws.mjs";
import { fetchAzurePricing } from "../lib/providers/azure.mjs";
import { fetchGcpPricing } from "../lib/providers/gcp.mjs";
import { getShapeMappings } from "../lib/runtime-data.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const pricingDir = path.join(repoRoot, "src/data/generated/pricing");
const manifestPath = path.join(repoRoot, "src/data/generated/cache-manifest.json");

async function main() {
  await fs.mkdir(pricingDir, { recursive: true });
  const shapeMappings = getShapeMappings();
  const gcpMachineTypes = [...new Set(shapeMappings.map((mapping) => mapping.gcp))];
  const awsMachineTypes = [...new Set(shapeMappings.map((mapping) => mapping.aws))];
  const azureMachineTypes = [...new Set(shapeMappings.map((mapping) => mapping.azure))];

  const providers = [
    ["gcp", () => fetchGcpPricing({ regions: providerTargets.gcp.regions, machineTypes: gcpMachineTypes })],
    ["aws", () => fetchAwsPricing({ regions: providerTargets.aws.regions, machineTypes: awsMachineTypes })],
    ["azure", () => fetchAzurePricing({ regions: providerTargets.azure.regions, machineTypes: azureMachineTypes })]
  ];
  const manifest = {
    source: "github-actions-pricing-cron",
    generated_at: new Date().toISOString(),
    pricing: {},
    explanations: {
      single: null,
      compare: null
    }
  };

  for (const [cloud, fetchPricing] of providers) {
    const payload = await fetchPricing();
    await fs.writeFile(path.join(pricingDir, `${cloud}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    manifest.pricing[cloud] = payload.retrieved_at;
    console.log(`Wrote generated pricing snapshot for ${cloud}.`);
  }

  await upsertManifest(manifest);
  console.log("Pricing snapshot refresh complete.");
}

async function upsertManifest(nextManifest) {
  try {
    const currentManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    nextManifest.explanations = currentManifest.explanations ?? nextManifest.explanations;
  } catch {
    // No existing manifest; write fresh one.
  }

  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error("Failed to refresh pricing snapshot.");
  console.error(error);
  process.exit(1);
});
