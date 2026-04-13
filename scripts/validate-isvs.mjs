import fs from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";

const root = process.cwd();
const schemaPath = path.join(root, "src/schemas/isv.schema.json");
const isvDir = path.join(root, "src/content/isvs");

const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(schema);
const filenames = (await fs.readdir(isvDir)).filter((file) => file.endsWith(".yaml"));

let hasErrors = false;

for (const filename of filenames) {
  const fullPath = path.join(isvDir, filename);
  const parsed = YAML.parse(await fs.readFile(fullPath, "utf8"));
  const valid = validate(parsed);
  const expectedSlug = filename.replace(/\.yaml$/, "");

  if (parsed?.slug !== expectedSlug) {
    hasErrors = true;
    console.error(`Slug mismatch in ${filename}: expected "${expectedSlug}", received "${parsed?.slug}"`);
  }

  if (!valid) {
    hasErrors = true;
    console.error(`Schema validation failed for ${filename}`);
    for (const error of validate.errors ?? []) {
      console.error(`  ${error.instancePath || "/"} ${error.message ?? "Invalid value"}`);
    }
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log(`Validated ${filenames.length} ISV YAML file(s).`);
