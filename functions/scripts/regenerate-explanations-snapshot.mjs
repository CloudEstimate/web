import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { buildCompareTuples, buildEstimateTuples } from "../lib/estimate-engine.mjs";
import { requireProjectId } from "../lib/config.mjs";
import { buildComparePrompt, buildSinglePrompt, sharedSystemPrompt } from "../lib/prompts.mjs";
import { getIsvCatalog } from "../lib/runtime-data.mjs";
import { validateExplanation } from "../lib/validate-explanation.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const pricingDir = path.join(repoRoot, "src/data/generated/pricing");
const explanationsDir = path.join(repoRoot, "src/data/generated/explanations");
const manifestPath = path.join(repoRoot, "src/data/generated/cache-manifest.json");
const pipelineMetricsDir = path.join(repoRoot, "src/data/generated/pipeline-metrics");
const llmRunsPath = path.join(pipelineMetricsDir, "llm-regeneration-runs.json");
const snapshotRunsPath = path.join(pipelineMetricsDir, "snapshot-runs.json");

const CHECKPOINT_INTERVAL = 25;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_METRICS_ENTRIES = 400;
const WORKFLOW_NAME = "regenerate-explanations";
const SCHEDULED_CRON = "0 2 * * *";
const TOKEN_USAGE_FIELDS = [
  ["promptTokenCount", "prompt_token_count"],
  ["candidatesTokenCount", "candidates_token_count"],
  ["totalTokenCount", "total_token_count"],
  ["cachedContentTokenCount", "cached_content_token_count"],
  ["thoughtsTokenCount", "thoughts_token_count"],
  ["toolUsePromptTokenCount", "tool_use_prompt_token_count"]
];

async function main() {
  const startedAtMs = Date.now();
  const runMetrics = buildLlmRunMetrics(new Date(startedAtMs).toISOString());
  let attempted = 0;
  let generated = 0;
  let skippedExisting = 0;
  let validationFailures = 0;

  try {
    const ai = new GoogleGenAI({
      vertexai: true,
      project: requireProjectId(),
      location: process.env.CLOUDESTIMATE_GCP_LOCATION ?? "global"
    });
    const model = process.env.CLOUDESTIMATE_VERTEX_MODEL ?? "gemini-3.5-flash";
    runMetrics.model = model;
    const pricingByCloud = await loadPricing();
    const singleAggregate = await loadAggregate("single.json");
    const compareAggregate = await loadAggregate("compare.json");
    const options = readGenerationOptions();
    runMetrics.options = options;
    let checkpointing = false;
    let sinceCheckpoint = 0;

    const canAttemptMore = () => {
      if (options.maxNewExplanations > 0 && attempted >= options.maxNewExplanations) {
        return false;
      }

      return !(options.timeBudgetMs > 0 && Date.now() - startedAtMs >= options.timeBudgetMs);
    };

    const workItems = buildWorkQueue(singleAggregate, compareAggregate, pricingByCloud, (n) => {
      skippedExisting += n;
    });
    runMetrics.work_items_queued = workItems.length;

    await runWithConcurrency(workItems, options.concurrency, async (item) => {
      if (!canAttemptMore()) return;

      attempted += 1;
      const explanation = await generateWithValidation(ai, model, buildPrompt(item), {
        onUsage: (usageMetadata) => recordUsage(runMetrics, usageMetadata),
        onError: () => {
          runMetrics.llm_api_errors_or_timeouts += 1;
        }
      });

      if (explanation) {
        const payload = {
          key: item.key,
          generated_at: new Date().toISOString(),
          model,
          explanation,
          source_refs: [item.isv.ref_arch.source_url]
        };

        if (item.type === "single") {
          singleAggregate[item.key] = payload;
        } else {
          compareAggregate[item.key] = payload;
        }

        generated += 1;
        sinceCheckpoint += 1;

        if (!checkpointing && sinceCheckpoint >= CHECKPOINT_INTERVAL) {
          checkpointing = true;
          sinceCheckpoint = 0;
          await writeAggregates(singleAggregate, compareAggregate);
          checkpointing = false;
        }
      } else {
        validationFailures += 1;
      }
    });

    await writeAggregates(singleAggregate, compareAggregate);
    await upsertManifest();
    finalizeLlmRunMetrics(runMetrics, {
      conclusion: "success",
      completedAtMs: Date.now(),
      startedAtMs,
      attempted,
      generated,
      skippedExisting,
      validationFailures
    });
    await writeLlmRunMetrics(runMetrics);
    await writeSnapshotRunRecord(buildSnapshotRunRecord(runMetrics));
    console.log(
      `Explanation snapshot regeneration complete. Attempted ${attempted}, generated ${generated}, skipped ${skippedExisting} existing, validation failures ${validationFailures}.`
    );
    console.log(
      `LLM token usage for this run: prompt ${runMetrics.token_usage.prompt_token_count}, output ${runMetrics.token_usage.candidates_token_count}, total ${runMetrics.token_usage.total_token_count}.`
    );
  } catch (error) {
    finalizeLlmRunMetrics(runMetrics, {
      conclusion: "failure",
      completedAtMs: Date.now(),
      startedAtMs,
      attempted,
      generated,
      skippedExisting,
      validationFailures,
      error
    });
    await writeFailureMetrics(runMetrics);
    throw error;
  }
}

function buildWorkQueue(singleAggregate, compareAggregate, pricingByCloud, onSkip) {
  const workItems = [];
  let skipped = 0;

  for (const isv of getIsvCatalog()) {
    for (const tuple of buildEstimateTuples(isv, pricingByCloud)) {
      if (tuple.term !== "on-demand") continue;

      const key = [isv.slug, tuple.cloud, tuple.size, tuple.ha ? "ha" : "noha", tuple.region].join(":");

      if (singleAggregate[key]?.explanation) {
        skipped += 1;
        continue;
      }

      workItems.push({ type: "single", isv, tuple, key });
    }

    for (const tuple of buildCompareTuples(isv, pricingByCloud)) {
      const key = [isv.slug, tuple.size, tuple.ha ? "ha" : "noha", tuple.term].join(":");

      if (compareAggregate[key]?.explanation) {
        skipped += 1;
        continue;
      }

      workItems.push({ type: "compare", isv, tuple, key });
    }
  }

  onSkip(skipped);
  return workItems;
}

function buildPrompt(item) {
  if (item.type === "single") {
    return buildSinglePrompt({
      isv: item.isv,
      size: item.isv.sizes[item.tuple.size],
      cloudName: item.tuple.cloud === "gcp" ? "Google Cloud" : item.tuple.cloud === "aws" ? "AWS" : "Azure",
      region: item.tuple.region,
      ha: item.tuple.ha,
      term: item.tuple.term,
      estimate: item.tuple.estimate
    });
  }

  return buildComparePrompt({
    isv: item.isv,
    size: item.isv.sizes[item.tuple.size],
    ha: item.tuple.ha,
    term: item.tuple.term,
    estimates: item.tuple.estimates
  });
}

async function runWithConcurrency(items, concurrency, processor) {
  const queue = [...items];

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        await processor(item);
      }
    })
  );
}

async function loadPricing() {
  const pricingByCloud = {};

  for (const cloud of ["gcp", "aws", "azure"]) {
    const filePath = path.join(pricingDir, `${cloud}.json`);
    pricingByCloud[cloud] = JSON.parse(await fs.readFile(filePath, "utf8"));
  }

  return pricingByCloud;
}

async function loadAggregate(filename) {
  try {
    return JSON.parse(await fs.readFile(path.join(explanationsDir, filename), "utf8"));
  } catch {
    return {};
  }
}

async function writeAggregates(singleAggregate, compareAggregate) {
  await fs.mkdir(explanationsDir, { recursive: true });
  await fs.writeFile(path.join(explanationsDir, "single.json"), `${JSON.stringify(singleAggregate, null, 2)}\n`);
  await fs.writeFile(path.join(explanationsDir, "compare.json"), `${JSON.stringify(compareAggregate, null, 2)}\n`);
}

function readGenerationOptions() {
  return {
    maxNewExplanations: readPositiveIntegerEnv("CLOUDESTIMATE_EXPLANATION_LIMIT"),
    timeBudgetMs: readPositiveIntegerEnv("CLOUDESTIMATE_EXPLANATION_TIME_BUDGET_MS"),
    concurrency: readPositiveIntegerEnv("CLOUDESTIMATE_EXPLANATION_CONCURRENCY") || 12
  };
}

function readPositiveIntegerEnv(name) {
  const raw = process.env[name];

  if (!raw) {
    return 0;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a positive integer when set.`);
  }

  return parsed;
}

async function generateWithValidation(ai, model, userPrompt, hooks = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await sleep(attempt * 2000);
    }

    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: userPrompt,
          config: {
            systemInstruction: sharedSystemPrompt,
            temperature: 0.2,
            maxOutputTokens: 384,
            thinkingConfig: { thinkingBudget: 0 }
          }
        }),
        REQUEST_TIMEOUT_MS
      );
      hooks.onUsage?.(response.usageMetadata);
      const text = response.text?.trim();

      if (!text) {
        continue;
      }

      const validation = validateExplanation(text);
      if (validation.ok) {
        return text;
      }
    } catch {
      hooks.onError?.();
      // timeout or transient API error — retry with backoff
    }
  }

  return null;
}

async function upsertManifest() {
  const manifest = {
    source: "github-actions-explanations-cron",
    generated_at: new Date().toISOString(),
    pricing: {},
    explanations: {
      single: "src/data/generated/explanations/single.json",
      compare: "src/data/generated/explanations/compare.json"
    }
  };

  try {
    const currentManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.pricing = currentManifest.pricing ?? {};
  } catch {
    // No manifest exists yet; continue with defaults.
  }

  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function buildLlmRunMetrics(startedAt) {
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
    model: null,
    options: null,
    work_items_queued: 0,
    attempted: 0,
    generated: 0,
    skipped_existing: 0,
    validation_failures: 0,
    llm_api_responses: 0,
    llm_api_responses_with_usage_metadata: 0,
    llm_api_responses_without_usage_metadata: 0,
    llm_api_errors_or_timeouts: 0,
    token_usage: createEmptyTokenUsage(),
    usage_metadata_fields_seen: [],
    error_message: null
  };
}

function finalizeLlmRunMetrics(metrics, args) {
  metrics.completed_at = new Date(args.completedAtMs).toISOString();
  metrics.duration_ms = args.completedAtMs - args.startedAtMs;
  metrics.conclusion = args.conclusion;
  metrics.attempted = args.attempted;
  metrics.generated = args.generated;
  metrics.skipped_existing = args.skippedExisting;
  metrics.validation_failures = args.validationFailures;

  if (args.error) {
    metrics.error_message = args.error instanceof Error ? args.error.message : String(args.error);
  }
}

function createEmptyTokenUsage() {
  return Object.fromEntries(TOKEN_USAGE_FIELDS.map(([, outputField]) => [outputField, 0]));
}

function recordUsage(metrics, usageMetadata) {
  metrics.llm_api_responses += 1;

  if (!usageMetadata) {
    metrics.llm_api_responses_without_usage_metadata += 1;
    return;
  }

  metrics.llm_api_responses_with_usage_metadata += 1;

  for (const field of Object.keys(usageMetadata)) {
    if (!metrics.usage_metadata_fields_seen.includes(field)) {
      metrics.usage_metadata_fields_seen.push(field);
      metrics.usage_metadata_fields_seen.sort();
    }
  }

  for (const [inputField, outputField] of TOKEN_USAGE_FIELDS) {
    const snakeField = outputField;
    const value = Number(usageMetadata[inputField] ?? usageMetadata[snakeField] ?? 0);

    if (Number.isFinite(value)) {
      metrics.token_usage[outputField] += value;
    }
  }
}

function buildSnapshotRunRecord(metrics) {
  return {
    workflow_name: metrics.workflow_name,
    scheduled_cron: metrics.scheduled_cron,
    event_name: metrics.event_name,
    run_id: metrics.run_id,
    run_attempt: metrics.run_attempt,
    actor: metrics.actor,
    ref: metrics.ref,
    commit_sha: metrics.commit_sha,
    started_at: metrics.started_at,
    completed_at: metrics.completed_at,
    duration_ms: metrics.duration_ms,
    conclusion: metrics.conclusion,
    artifact_source: "github-actions-explanations-cron",
    generated: metrics.generated,
    attempted: metrics.attempted,
    skipped_existing: metrics.skipped_existing,
    validation_failures: metrics.validation_failures,
    llm_total_token_count: metrics.token_usage.total_token_count,
    error_message: metrics.error_message
  };
}

async function writeLlmRunMetrics(metrics) {
  await appendJsonArray(llmRunsPath, metrics);
}

async function writeSnapshotRunRecord(record) {
  await appendJsonArray(snapshotRunsPath, record);
}

async function writeFailureMetrics(metrics) {
  try {
    await writeLlmRunMetrics(metrics);
    await writeSnapshotRunRecord(buildSnapshotRunRecord(metrics));
  } catch (metricsError) {
    console.error("Failed to write pipeline metrics for failed explanation regeneration run.");
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

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Vertex request timed out after ${ms}ms`)), ms)
    )
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("Failed to regenerate explanation snapshots.");
  console.error(error);
  process.exit(1);
});
