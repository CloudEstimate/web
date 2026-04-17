import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { requireEnv, requireProjectId } from "./config.mjs";
import { buildCompareTuples, buildEstimateTuples } from "./estimate-engine.mjs";
import { buildComparePrompt, buildSinglePrompt, sharedSystemPrompt } from "./prompts.mjs";
import { findLatestFile, getCacheBucket, readJson, writeJson } from "./storage.mjs";
import { validateExplanation } from "./validate-explanation.mjs";
import { getIsvCatalog } from "./runtime-data.mjs";

export async function regenerateExplanationCaches() {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: requireProjectId(),
    location: process.env.CLOUDESTIMATE_GCP_LOCATION ?? "global"
  });
  const model = process.env.CLOUDESTIMATE_VERTEX_MODEL ?? "gemini-2.5-pro";
  const bucket = getCacheBucket();
  const pricingByCloud = await loadLatestPricing(bucket);
  const singleAggregate = {};
  const compareAggregate = {};

  for (const isv of getIsvCatalog()) {
    for (const tuple of buildEstimateTuples(isv, pricingByCloud)) {
      const key = [isv.slug, tuple.cloud, tuple.size, tuple.ha ? "ha" : "noha", tuple.term, tuple.region].join(":");
      const explanation = await generateWithValidation(ai, model, buildSinglePrompt({
        isv,
        size: isv.sizes[tuple.size],
        cloudName: tuple.cloud === "gcp" ? "Google Cloud" : tuple.cloud === "aws" ? "AWS" : "Azure",
        region: tuple.region,
        ha: tuple.ha,
        term: tuple.term,
        estimate: tuple.estimate
      }));

      if (!explanation) {
        logger.warn(`Skipping single-cloud explanation after validation failures for ${key}.`);
        continue;
      }

      const payload = {
        key,
        generated_at: new Date().toISOString(),
        model,
        explanation,
        source_refs: [isv.ref_arch.source_url]
      };

      singleAggregate[key] = payload;
      await writeJson(bucket.file(`explanations/single/${toFilename(key)}.json`), payload);
    }

    for (const tuple of buildCompareTuples(isv, pricingByCloud)) {
      const key = [isv.slug, tuple.size, tuple.ha ? "ha" : "noha", tuple.term].join(":");
      const explanation = await generateWithValidation(ai, model, buildComparePrompt({
        isv,
        size: isv.sizes[tuple.size],
        ha: tuple.ha,
        term: tuple.term,
        estimates: tuple.estimates
      }));

      if (!explanation) {
        logger.warn(`Skipping compare explanation after validation failures for ${key}.`);
        continue;
      }

      const payload = {
        key,
        generated_at: new Date().toISOString(),
        model,
        explanation,
        source_refs: [isv.ref_arch.source_url]
      };

      compareAggregate[key] = payload;
      await writeJson(bucket.file(`explanations/compare/${toFilename(key)}.json`), payload);
    }
  }

  await writeJson(bucket.file("site-build/explanations-single.json"), singleAggregate);
  await writeJson(bucket.file("site-build/explanations-compare.json"), compareAggregate);
}

async function loadLatestPricing(bucket) {
  const pricingByCloud = {};

  for (const cloud of ["gcp", "aws", "azure"]) {
    const latestFile = await findLatestFile(bucket, `pricing/${cloud}-`);
    if (!latestFile) {
      throw new Error(`Missing pricing cache for ${cloud}.`);
    }

    pricingByCloud[cloud] = await readJson(latestFile);
  }

  return pricingByCloud;
}

async function generateWithValidation(ai, model, userPrompt) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction: sharedSystemPrompt
      }
    });
    const text = response.text?.trim();

    if (!text) {
      continue;
    }

    const validation = validateExplanation(text);
    if (validation.ok) {
      return text;
    }

    logger.warn(`Explanation validation failed: ${validation.reason}`);
  }

  return null;
}

function toFilename(value) {
  return value.replace(/[^a-z0-9:-]+/gi, "-").replace(/:/g, "--");
}
