import { Storage } from "@google-cloud/storage";
import { requireEnv } from "./config.mjs";

const storage = new Storage();

export function getCacheBucket() {
  const bucketName = requireEnv("CLOUDESTIMATE_CACHE_BUCKET");
  return storage.bucket(bucketName);
}

export async function writeJson(file, data) {
  await file.save(JSON.stringify(data, null, 2), {
    contentType: "application/json; charset=utf-8"
  });
}

export async function readJson(file) {
  const [contents] = await file.download();
  return JSON.parse(contents.toString("utf8"));
}

export async function findLatestFile(bucket, prefix, matcher = (name) => name.endsWith(".json")) {
  const [files] = await bucket.getFiles({ prefix });
  const candidates = files.filter((file) => matcher(file.name));

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => extractDate(right.name).localeCompare(extractDate(left.name)))[0];
}

function extractDate(filename) {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? "0000-00-00";
}
