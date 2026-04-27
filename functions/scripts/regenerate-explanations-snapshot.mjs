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

const CHECKPOINT_INTERVAL = 25;
const REQUEST_TIMEOUT_MS = 30_000;

async function main() {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: requireProjectId(),
    location: process.env.CLOUDESTIMATE_GCP_LOCATION ?? "global"
  });
  const model = process.env.CLOUDESTIMATE_VERTEX_MODEL ?? "gemini-2.5-flash";
  const pricingByCloud = await loadPricing();
  const singleAggregate = await loadAggregate("single.json");
  const compareAggregate = await loadAggregate("compare.json");
  const options = readGenerationOptions();
  const startedAt = Date.now();
  let attempted = 0;
  let generated = 0;
  let skippedExisting = 0;
  let validationFailures = 0;
  let checkpointing = false;
  let sinceCheckpoint = 0;

  const canAttemptMore = () => {
    if (options.maxNewExplanations > 0 && attempted >= options.maxNewExplanations) {
      return false;
    }

    return !(options.timeBudgetMs > 0 && Date.now() - startedAt >= options.timeBudgetMs);
  };

  const workItems = buildWorkQueue(singleAggregate, compareAggregate, pricingByCloud, (n) => { skippedExisting += n; });

  await runWithConcurrency(workItems, options.concurrency, async (item) => {
    if (!canAttemptMore()) return;

    attempted += 1;
    const explanation = await generateWithValidation(ai, model, buildPrompt(item));

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
  console.log(
    `Explanation snapshot regeneration complete. Attempted ${attempted}, generated ${generated}, skipped ${skippedExisting} existing, validation failures ${validationFailures}.`
  );
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

async function generateWithValidation(ai, model, userPrompt) {
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
      const text = response.text?.trim();

      if (!text) {
        continue;
      }

      const validation = validateExplanation(text);
      if (validation.ok) {
        return text;
      }
    } catch {
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
