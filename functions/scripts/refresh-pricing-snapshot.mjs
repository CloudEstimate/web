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
const pipelineMetricsDir = path.join(repoRoot, "src/data/generated/pipeline-metrics");
const snapshotRunsPath = path.join(pipelineMetricsDir, "snapshot-runs.json");

const MAX_METRICS_ENTRIES = 400;
const WORKFLOW_NAME = "refresh-pricing";
const SCHEDULED_CRON = "0 2 * * *";

async function main() {
  const startedAtMs = Date.now();
  const runRecord = buildSnapshotRunRecord(new Date(startedAtMs).toISOString());

  try {
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
      const providerStartedAt = Date.now();
      const payload = await fetchPricing();
      await fs.writeFile(path.join(pricingDir, `${cloud}.json`), `${JSON.stringify(payload, null, 2)}\n`);
      manifest.pricing[cloud] = payload.retrieved_at;
      runRecord.providers[cloud] = {
        retrieved_at: payload.retrieved_at,
        regions_count: Object.keys(payload.regions ?? {}).length,
        duration_ms: Date.now() - providerStartedAt
      };
      console.log(`Wrote generated pricing snapshot for ${cloud}.`);
    }

    await upsertManifest(manifest);
    finalizeSnapshotRunRecord(runRecord, {
      conclusion: "success",
      completedAtMs: Date.now(),
      startedAtMs,
      generatedAt: manifest.generated_at,
      pricing: manifest.pricing
    });
    await writeSnapshotRunRecord(runRecord);
    console.log("Pricing snapshot refresh complete.");
  } catch (error) {
    finalizeSnapshotRunRecord(runRecord, {
      conclusion: "failure",
      completedAtMs: Date.now(),
      startedAtMs,
      error
    });
    await writeFailureMetrics(runRecord);
    throw error;
  }
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

function buildSnapshotRunRecord(startedAt) {
  return {
    workflow_name: WORKFLOW_NAME,
    scheduled_cron: SCHEDULED_CRON,
    event_name: process.env.GITHUB_EVENT_NAME ?? "local",
    run_id: process.env.GITHUB_RUN_ID ?? null,
    run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    actor: process.env.GITHUB_ACTOR ?? null,
    ref: process.env.GITHUB_REF ?? null,
    commit_sha: process.env.GITHUB_SHA ?? null,
    started_at: startedAt,
    completed_at: null,
    duration_ms: null,
    conclusion: null,
    artifact_source: "github-actions-pricing-cron",
    generated_at: null,
    pricing: {},
    providers: {},
    non_llm_provider_api_calls: ["google-cloud-billing-catalog", "aws-public-pricing-offers", "azure-retail-prices"],
    llm_total_token_count: 0,
    error_message: null
  };
}

function finalizeSnapshotRunRecord(record, args) {
  record.completed_at = new Date(args.completedAtMs).toISOString();
  record.duration_ms = args.completedAtMs - args.startedAtMs;
  record.conclusion = args.conclusion;
  record.generated_at = args.generatedAt ?? null;
  record.pricing = args.pricing ?? record.pricing;

  if (args.error) {
    record.error_message = args.error instanceof Error ? args.error.message : String(args.error);
  }
}

async function writeSnapshotRunRecord(record) {
  await appendJsonArray(snapshotRunsPath, record);
}

async function writeFailureMetrics(record) {
  try {
    await writeSnapshotRunRecord(record);
  } catch (metricsError) {
    console.error("Failed to write pipeline metrics for failed pricing refresh run.");
    console.error(metricsError);
  }
}

async function appendJsonArray(filePath, entry) {
  let records = [];

  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (Array.isArray(parsed)) {
      records = parsed;
    }
  } catch {
    // Missing or invalid metrics file; start a fresh bounded history.
  }

  records.push(entry);
  records = records.slice(-MAX_METRICS_ENTRIES);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(records, null, 2)}\n`);
}

main().catch((error) => {
  console.error("Failed to refresh pricing snapshot.");
  console.error(error);
  process.exit(1);
});
