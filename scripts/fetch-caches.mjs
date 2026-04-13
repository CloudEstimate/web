import fs from "node:fs/promises";
import path from "node:path";
import { Storage } from "@google-cloud/storage";

const root = process.cwd();
const bucketName = process.env.CLOUDESTIMATE_CACHE_BUCKET;
const generatedPricingDir = path.join(root, "src/data/generated/pricing");
const generatedExplanationsDir = path.join(root, "src/data/generated/explanations");
const generatedManifestPath = path.join(root, "src/data/generated/cache-manifest.json");
const singleAggregateFile = "site-build/explanations-single.json";
const compareAggregateFile = "site-build/explanations-compare.json";

const storage = bucketName ? new Storage() : null;

async function main() {
  await fs.mkdir(generatedPricingDir, { recursive: true });
  await fs.mkdir(generatedExplanationsDir, { recursive: true });

  if (!bucketName || !storage) {
    console.log("CLOUDESTIMATE_CACHE_BUCKET is not set. Using local generated caches.");
    return;
  }

  const bucket = storage.bucket(bucketName);
  const manifest = {
    source: bucketName,
    generated_at: new Date().toISOString(),
    pricing: {},
    explanations: {
      single: null,
      compare: null
    }
  };

  for (const cloud of ["gcp", "aws", "azure"]) {
    const latest = await findLatestPricingFile(bucket, cloud);
    if (!latest) {
      console.log(`No remote pricing file found for ${cloud}. Keeping existing generated cache.`);
      continue;
    }

    await latest.download({ destination: path.join(generatedPricingDir, `${cloud}.json`) });
    manifest.pricing[cloud] = latest.name;
  }

  const singleAggregate = bucket.file(singleAggregateFile);
  const compareAggregate = bucket.file(compareAggregateFile);

  if (await fileExists(singleAggregate)) {
    await singleAggregate.download({ destination: path.join(generatedExplanationsDir, "single.json") });
    manifest.explanations.single = singleAggregate.name;
  } else {
    console.log("No aggregated single-cloud explanations file found. Keeping existing generated cache.");
  }

  if (await fileExists(compareAggregate)) {
    await compareAggregate.download({ destination: path.join(generatedExplanationsDir, "compare.json") });
    manifest.explanations.compare = compareAggregate.name;
  } else {
    console.log("No aggregated compare explanations file found. Keeping existing generated cache.");
  }

  await fs.writeFile(generatedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Fetched latest pricing and explanation caches from gs://${bucketName}`);
}

async function findLatestPricingFile(bucket, cloud) {
  const [files] = await bucket.getFiles({ prefix: `pricing/${cloud}-` });
  const candidates = files.filter((file) => file.name.endsWith(".json"));

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => extractDate(right.name).localeCompare(extractDate(left.name)))[0];
}

function extractDate(filename) {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? "0000-00-00";
}

async function fileExists(file) {
  const [exists] = await file.exists();
  return exists;
}

main().catch((error) => {
  console.error("Failed to fetch remote caches.");
  console.error(error);
  process.exit(1);
});
