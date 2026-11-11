import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { logger } from "firebase-functions/v2";
import { requireProjectId } from "./config.mjs";
import { buildCompareTuples, buildEstimateTuples } from "./estimate-engine.mjs";
import { buildComparePrompt, buildSinglePrompt, sharedSystemPrompt } from "./prompts.mjs";
import { findLatestFile, getCacheBucket, readJson, writeJson } from "./storage.mjs";
import { validateExplanation } from "./validate-explanation.mjs";
import { getIsvCatalog } from "./runtime-data.mjs";

function hashPrompt(prompt) {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

export async function regenerateExplanationCaches() {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: requireProjectId(),
    location: process.env.CLOUDESTIMATE_GCP_LOCATION ?? "global"
  });
  const model = process.env.CLOUDESTIMATE_VERTEX_MODEL ?? "gemini-3.5-flash-lite";
  const bucket = getCacheBucket();
  const pricingByCloud = await loadLatestPricing(bucket);
  const singleAggregate = {};
  const compareAggregate = {};

  for (const isv of getIsvCatalog()) {
    for (const tuple of buildEstimateTuples(isv, pricingByCloud)) {
      if (tuple.term !== "on-demand") continue;

      const key = [isv.slug, tuple.cloud, tuple.size, tuple.ha ? "ha" : "noha", tuple.region].join(":");
      const prompt = buildSinglePrompt({
        isv,
        size: isv.sizes[tuple.size],
        cloudName: tuple.cloud === "gcp" ? "Google Cloud" : tuple.cloud === "aws" ? "AWS" : "Azure",
        region: tuple.region,
        ha: tuple.ha,
        term: tuple.term,
        estimate: tuple.estimate
      });
      const explanation = await generateWithValidation(ai, model, prompt);

      if (!explanation) {
        logger.warn(`Skipping single-cloud explanation after validation failures for ${key}.`);
        continue;
      }

      const payload = {
        key,
        generated_at: new Date().toISOString(),
        model,
        prompt_hash: hashPrompt(prompt),
        explanation,
        source_refs: [isv.ref_arch.source_url]
      };

      singleAggregate[key] = payload;
      await writeJson(bucket.file(`explanations/single/${toFilename(key)}.json`), payload);
    }

    for (const tuple of buildCompareTuples(isv, pricingByCloud)) {
      const key = [isv.slug, tuple.size, tuple.ha ? "ha" : "noha", tuple.term].join(":");
      const prompt = buildComparePrompt({
        isv,
        size: isv.sizes[tuple.size],
        ha: tuple.ha,
        term: tuple.term,
        estimates: tuple.estimates
      });
      const explanation = await generateWithValidation(ai, model, prompt);

      if (!explanation) {
        logger.warn(`Skipping compare explanation after validation failures for ${key}.`);
        continue;
      }

      const payload = {
        key,
        generated_at: new Date().toISOString(),
        model,
        prompt_hash: hashPrompt(prompt),
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
  const thinkingLevel = model.startsWith("gemini-4") ? "LOW" : "MINIMAL";
  let lastReason = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const promptWithFeedback = lastReason
      ? `${userPrompt}\n\nPrevious draft failed check (${lastReason}). Output strictly 3 to 4 plain sentences totaling 240 to 520 characters.`
      : userPrompt;

    const response = await ai.models.generateContent({
      model,
      contents: promptWithFeedback,
      config: {
        systemInstruction: sharedSystemPrompt,
        maxOutputTokens: 512,
        thinkingConfig: { thinkingLevel }
      }
    });
    const text = response.text?.trim();

    if (!text) {
      lastReason = "Empty response";
      continue;
    }

    const validation = validateExplanation(text);
    if (validation.ok) {
      return text;
    }

    lastReason = validation.reason;
    logger.warn(`Explanation validation failed: ${validation.reason}`);
  }

  return null;
}

function toFilename(value) {
  return value.replace(/[^a-z0-9:-]+/gi, "-").replace(/:/g, "--");
}
