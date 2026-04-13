import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const generatedPricingDir = path.join(root, "src/data/generated/pricing");
const generatedExplanationsDir = path.join(root, "src/data/generated/explanations");
const generatedManifestPath = path.join(root, "src/data/generated/cache-manifest.json");

const seededPricing = {
  gcp: path.join(root, "src/data/pricing/gcp-2026-04-12.json"),
  aws: path.join(root, "src/data/pricing/aws-2026-04-12.json"),
  azure: path.join(root, "src/data/pricing/azure-2026-04-12.json")
};

async function ensureFile(filePath, fallbackContent) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, fallbackContent);
  }
}

await fs.mkdir(generatedPricingDir, { recursive: true });
await fs.mkdir(generatedExplanationsDir, { recursive: true });

for (const [cloud, seedPath] of Object.entries(seededPricing)) {
  const targetPath = path.join(generatedPricingDir, `${cloud}.json`);

  try {
    await fs.access(targetPath);
  } catch {
    await fs.copyFile(seedPath, targetPath);
  }
}

await ensureFile(path.join(generatedExplanationsDir, "single.json"), "{}\n");
await ensureFile(path.join(generatedExplanationsDir, "compare.json"), "{}\n");
await ensureFile(
  generatedManifestPath,
  `${JSON.stringify(
    {
      source: "repository-seeded",
      generated_at: "2026-04-12T00:00:00Z",
      pricing: {
        gcp: "gcp-2026-04-12.json",
        aws: "aws-2026-04-12.json",
        azure: "azure-2026-04-12.json"
      },
      explanations: {
        single: null,
        compare: null
      }
    },
    null,
    2
  )}\n`
);

console.log("Ensured generated cache files exist.");
