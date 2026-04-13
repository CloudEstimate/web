import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const isvDir = path.join(root, "src/content/isvs");
const shapeMappingsPath = path.join(root, "src/data/shape-mappings.yaml");
const estimateCorePath = path.join(root, "shared/estimate-core.mjs");
const outputDir = path.join(root, "functions/generated");

await fs.mkdir(outputDir, { recursive: true });

const isvFiles = (await fs.readdir(isvDir)).filter((file) => file.endsWith(".yaml")).sort();
const isvs = [];

for (const file of isvFiles) {
  const parsed = YAML.parse(await fs.readFile(path.join(isvDir, file), "utf8"));
  isvs.push(parsed);
}

const shapeMappings = YAML.parse(await fs.readFile(shapeMappingsPath, "utf8"));

await fs.writeFile(path.join(outputDir, "isv-catalog.json"), `${JSON.stringify(isvs, null, 2)}\n`);
await fs.writeFile(path.join(outputDir, "shape-mappings.json"), `${JSON.stringify(shapeMappings, null, 2)}\n`);
await fs.copyFile(estimateCorePath, path.join(outputDir, "estimate-core.mjs"));

console.log("Synced ISV catalog, shape mappings, and shared estimate core into functions/generated.");
