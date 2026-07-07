import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "src/data/generated/cache-manifest.json");
const MAX_AGE_HOURS = Number(process.env.CLOUDESTIMATE_MAX_SNAPSHOT_AGE_HOURS ?? 48);

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

const checks = [
  ["manifest.generated_at", manifest.generated_at],
  ["pricing.gcp", manifest.pricing?.gcp],
  ["pricing.aws", manifest.pricing?.aws],
  ["pricing.azure", manifest.pricing?.azure]
];

const now = Date.now();
let stale = false;

for (const [label, timestamp] of checks) {
  if (!timestamp) {
    console.error(`${label} is missing from the cache manifest.`);
    stale = true;
    continue;
  }

  const ageHours = (now - Date.parse(timestamp)) / (60 * 60 * 1000);

  if (!Number.isFinite(ageHours) || ageHours > MAX_AGE_HOURS) {
    console.error(`${label} is stale: ${timestamp} (${ageHours.toFixed(1)}h old, limit ${MAX_AGE_HOURS}h).`);
    stale = true;
  } else {
    console.log(`${label} is fresh: ${timestamp} (${ageHours.toFixed(1)}h old).`);
  }
}

if (stale) {
  console.error("Snapshot freshness check failed.");
  process.exit(1);
}

console.log("Snapshot freshness check passed.");
