import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import {
  isManagedLoadBalancerRole,
  isObjectStorageRole,
  pickDefaultRegion,
  pickShapeMapping
} from "../shared/estimate-core.mjs";
import { buildCloudTerraformSnippet } from "../shared/terraform-core.mjs";

const root = process.cwd();
const isvDir = path.join(root, "src/content/isvs");
const shapeMappingsPath = path.join(root, "src/data/shape-mappings.yaml");
const pricingDir = path.join(root, "src/data/generated/pricing");
const requiredTiers = ["xs", "m", "xl"];
const clouds = [
  { slug: "gcp", label: "Google Cloud", fallbackRegion: "us-central1" },
  { slug: "aws", label: "AWS", fallbackRegion: "us-east-1" },
  { slug: "azure", label: "Azure", fallbackRegion: "eastus" }
];
const mode = readMode();
const cloudFilter = readCloudFilter();
const terraformProjectId =
  process.env.TF_VAR_project_id ??
  process.env.CLOUDESTIMATE_GCP_PROJECT_ID ??
  process.env.GCLOUD_PROJECT ??
  "example-project-id";

const shapeMappings = YAML.parse(await fs.readFile(shapeMappingsPath, "utf8"));
const pricingByCloud = {};
for (const cloud of clouds) {
  pricingByCloud[cloud.slug] = JSON.parse(
    await fs.readFile(path.join(pricingDir, `${cloud.slug}.json`), "utf8")
  );
}

const activeClouds = cloudFilter ? clouds.filter((c) => c.slug === cloudFilter) : clouds;
const cases = [];
const failures = [];
const coveredTiers = new Set();

for (const file of (await fs.readdir(isvDir)).filter((entry) => entry.endsWith(".yaml")).sort()) {
  const isv = YAML.parse(await fs.readFile(path.join(isvDir, file), "utf8"));

  for (const size of Object.keys(isv.sizes ?? {})) {
    if (!requiredTiers.includes(size)) {
      continue;
    }

    for (const cloud of activeClouds) {
      const pricing = pricingByCloud[cloud.slug];
      const defaultRegion = pickDefaultRegion(pricing, cloud.fallbackRegion);
      const components = buildComponents({
        isv,
        size,
        cloud: cloud.slug,
        region: defaultRegion,
        pricing,
        shapeMappings
      });

      const snippet = buildCloudTerraformSnippet({
        cloud: cloud.slug,
        slug: isv.slug,
        region: defaultRegion,
        components,
        commentLabel: cloud.label
      });

      if (!snippet || !snippet.includes("required_providers")) {
        failures.push(`Empty or invalid Terraform snippet generated for ${isv.slug} (${cloud.slug} ${size}).`);
      }

      cases.push({
        slug: isv.slug,
        cloud: cloud.slug,
        size,
        region: defaultRegion,
        snippet
      });
    }

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
const pluginCacheDir = path.join(tempRoot, ".plugin-cache");

try {
  await fs.mkdir(pluginCacheDir, { recursive: true });
  for (const testCase of cases) {
    const caseDir = path.join(tempRoot, `${testCase.cloud}-${testCase.slug}-${testCase.size}`);
    await fs.mkdir(caseDir, { recursive: true });
    await fs.writeFile(path.join(caseDir, "main.tf"), `${testCase.snippet}\n`);
    if (testCase.cloud === "gcp") {
      await fs.writeFile(path.join(caseDir, "terraform.tfvars"), `project_id = "${terraformProjectId}"\n`);
    }
  }

  if (mode === "generate-only") {
    console.log(
      `Generated ${cases.length} multi-cloud Terraform/OpenTofu baselines (${activeClouds.map((c) => c.slug).join(", ")}) in ${tempRoot}`
    );
  } else {
    ensureTerraformInstalled();

    for (const testCase of cases) {
      const caseDir = path.join(tempRoot, `${testCase.cloud}-${testCase.slug}-${testCase.size}`);
      runTerraform(["init", "-backend=false", "-input=false", "-no-color"], caseDir, testCase);
      runTerraform(["validate", "-no-color"], caseDir, testCase);

      if (mode === "plan" && testCase.cloud === "gcp") {
        runTerraform(["plan", "-refresh=false", "-input=false", "-lock=false", "-no-color"], caseDir, testCase);
      }
    }

    console.log(
      `${mode === "plan" ? "Validated and planned" : "Validated"} ${cases.length} generated Terraform baselines across XS/M/XL tiers.`
    );
  }
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

function readCloudFilter() {
  const arg = process.argv.find((value) => value.startsWith("--cloud="));
  const parsed = arg?.split("=")[1] ?? "";

  if (parsed && !["gcp", "aws", "azure"].includes(parsed)) {
    throw new Error(`Unsupported --cloud="${parsed}". Use gcp, aws, or azure.`);
  }

  return parsed || null;
}

function buildComponents(args) {
  const regionPricing = args.pricing.regions[args.region];

  if (!regionPricing) {
    throw new Error(`Region "${args.region}" is missing from generated ${args.cloud} pricing.`);
  }

  return args.isv.sizes[args.size].components.map((component) => {
    if (isManagedLoadBalancerRole(component.role)) {
      return {
        role: component.role,
        count: component.count,
        gpu: 0,
        storageGb: 0,
        storageType: undefined,
        instanceType: "managed-lb"
      };
    }

    if (isObjectStorageRole(component.role, component.storage_type)) {
      return {
        role: component.role,
        count: component.count,
        gpu: 0,
        storageGb: component.storage_gb ?? 0,
        storageType: "object",
        instanceType: "object-bucket"
      };
    }

    const gpu = component.gpu ?? 0;
    const mapping = pickShapeMapping(args.shapeMappings, component.vcpu, component.memory_gb, gpu);
    const instanceType = mapping[args.cloud];

    if (!regionPricing.compute[instanceType]) {
      throw new Error(`Missing ${args.cloud} compute pricing for ${instanceType} in ${args.region}.`);
    }

    return {
      role: component.role,
      count: component.count,
      gpu,
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
      TF_IN_AUTOMATION: "1",
      TF_PLUGIN_CACHE_DIR: pluginCacheDir,
      TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE: "true"
    }
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Terraform ${args[0]} failed for ${testCase.slug} ${testCase.cloud} ${testCase.size.toUpperCase()} (${testCase.region}).`,
        result.stderr.trim() || result.stdout.trim()
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}
