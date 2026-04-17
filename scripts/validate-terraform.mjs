import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { pickDefaultRegion, pickShapeMapping } from "../shared/estimate-core.mjs";
import { buildGcpTerraformSnippet } from "../shared/terraform-core.mjs";

const root = process.cwd();
const isvDir = path.join(root, "src/content/isvs");
const shapeMappingsPath = path.join(root, "src/data/shape-mappings.yaml");
const gcpPricingPath = path.join(root, "src/data/generated/pricing/gcp.json");
const requiredTiers = ["xs", "m", "xl"];
const mode = readMode();
const terraformProjectId =
  process.env.TF_VAR_project_id ?? process.env.CLOUDESTIMATE_GCP_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? "example-project-id";

const shapeMappings = YAML.parse(await fs.readFile(shapeMappingsPath, "utf8"));
const pricing = JSON.parse(await fs.readFile(gcpPricingPath, "utf8"));
const defaultRegion = pickDefaultRegion(pricing, "us-central1");
const cases = [];
const failures = [];
const coveredTiers = new Set();

for (const file of (await fs.readdir(isvDir)).filter((entry) => entry.endsWith(".yaml")).sort()) {
  const isv = YAML.parse(await fs.readFile(path.join(isvDir, file), "utf8"));

  for (const size of Object.keys(isv.sizes ?? {})) {
    if (!requiredTiers.includes(size)) {
      continue;
    }

    const components = buildComponents({
      isv,
      size,
      region: defaultRegion,
      pricing,
      shapeMappings
    });

    cases.push({
      slug: isv.slug,
      size,
      region: defaultRegion,
      snippet: buildGcpTerraformSnippet({
        slug: isv.slug,
        region: defaultRegion,
        components,
        commentLabel: "Google Cloud"
      })
    });
    coveredTiers.add(size);
  }
}

for (const tier of requiredTiers) {
  if (!coveredTiers.has(tier)) {
    failures.push(`No ISV defines the ${tier.toUpperCase()} tier required by the Terraform quality gate.`);
  }
}

if (failures.length > 0) {
  throw new Error(failures.join("\n"));
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cloudestimate-terraform-"));

try {
  for (const testCase of cases) {
    const caseDir = path.join(tempRoot, `${testCase.slug}-${testCase.size}`);
    await fs.mkdir(caseDir, { recursive: true });
    await fs.writeFile(path.join(caseDir, "main.tf"), `${testCase.snippet}\n`);
    await fs.writeFile(path.join(caseDir, "terraform.tfvars"), `project_id = "${terraformProjectId}"\n`);
  }

  if (mode === "generate-only") {
    console.log(`Generated ${cases.length} Terraform validation cases in ${tempRoot}`);
    process.exit(0);
  }

  ensureTerraformInstalled();

  for (const testCase of cases) {
    const caseDir = path.join(tempRoot, `${testCase.slug}-${testCase.size}`);
    runTerraform(["init", "-backend=false", "-input=false", "-no-color"], caseDir, testCase);
    runTerraform(["validate", "-no-color"], caseDir, testCase);

    if (mode === "plan") {
      runTerraform(["plan", "-refresh=false", "-input=false", "-lock=false", "-no-color"], caseDir, testCase);
    }
  }

  console.log(
    `${mode === "plan" ? "Validated and planned" : "Validated"} ${cases.length} generated Terraform baselines across the available XS/M/XL tiers in ${defaultRegion}.`
  );
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

function readMode() {
  const arg = process.argv.find((value) => value.startsWith("--mode="));
  const parsed = arg?.split("=")[1] ?? "validate";

  if (!["generate-only", "validate", "plan"].includes(parsed)) {
    throw new Error(`Unsupported mode "${parsed}". Use --mode=generate-only, --mode=validate, or --mode=plan.`);
  }

  return parsed;
}

function buildComponents(args) {
  const regionPricing = args.pricing.regions[args.region];

  if (!regionPricing) {
    throw new Error(`Region "${args.region}" is missing from generated Google Cloud pricing.`);
  }

  return args.isv.sizes[args.size].components.map((component) => {
    const mapping = pickShapeMapping(args.shapeMappings, component.vcpu, component.memory_gb);
    const instanceType = mapping.gcp;

    if (!regionPricing.compute[instanceType]) {
      throw new Error(`Missing Google Cloud compute pricing for ${instanceType} in ${args.region}.`);
    }

    return {
      role: component.role,
      count: component.count,
      storageGb: component.storage_gb ?? 0,
      storageType: component.storage_type,
      instanceType
    };
  });
}

function ensureTerraformInstalled() {
  const result = spawnSync("terraform", ["version"], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error("Terraform is not installed or not available on PATH.");
  }
}

function runTerraform(args, cwd, testCase) {
  const result = spawnSync("terraform", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      TF_IN_AUTOMATION: "1"
    }
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Terraform ${args[0]} failed for ${testCase.slug} ${testCase.size.toUpperCase()} (${testCase.region}).`,
        result.stderr.trim() || result.stdout.trim()
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}
