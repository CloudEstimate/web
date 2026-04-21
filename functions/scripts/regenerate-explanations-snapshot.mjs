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

async function main() {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: requireProjectId(),
    location: process.env.CLOUDESTIMATE_GCP_LOCATION ?? "global"
  });
  const model = process.env.CLOUDESTIMATE_VERTEX_MODEL ?? "gemini-2.5-pro";
  const pricingByCloud = await loadPricing();
  const singleAggregate = {};
  const compareAggregate = {};

  for (const isv of getIsvCatalog()) {
    for (const tuple of buildEstimateTuples(isv, pricingByCloud)) {
      const key = [isv.slug, tuple.cloud, tuple.size, tuple.ha ? "ha" : "noha", tuple.term, tuple.region].join(":");
      const explanation = await generateWithValidation(
        ai,
        model,
        buildSinglePrompt({
          isv,
          size: isv.sizes[tuple.size],
          cloudName: tuple.cloud === "gcp" ? "Google Cloud" : tuple.cloud === "aws" ? "AWS" : "Azure",
          region: tuple.region,
          ha: tuple.ha,
          term: tuple.term,
          estimate: tuple.estimate
        })
      );

      if (explanation) {
        singleAggregate[key] = {
          key,
          generated_at: new Date().toISOString(),
          model,
          explanation,
          source_refs: [isv.ref_arch.source_url]
        };
      }
    }

    for (const tuple of buildCompareTuples(isv, pricingByCloud)) {
      const key = [isv.slug, tuple.size, tuple.ha ? "ha" : "noha", tuple.term].join(":");
      const explanation = await generateWithValidation(
        ai,
        model,
        buildComparePrompt({
          isv,
          size: isv.sizes[tuple.size],
          ha: tuple.ha,
          term: tuple.term,
          estimates: tuple.estimates
        })
      );

      if (explanation) {
        compareAggregate[key] = {
          key,
          generated_at: new Date().toISOString(),
          model,
          explanation,
          source_refs: [isv.ref_arch.source_url]
        };
      }
    }
  }

  await fs.mkdir(explanationsDir, { recursive: true });
  await fs.writeFile(path.join(explanationsDir, "single.json"), `${JSON.stringify(singleAggregate, null, 2)}\n`);
  await fs.writeFile(path.join(explanationsDir, "compare.json"), `${JSON.stringify(compareAggregate, null, 2)}\n`);
  await upsertManifest();
  console.log("Explanation snapshot regeneration complete.");
}

async function loadPricing() {
  const pricingByCloud = {};

  for (const cloud of ["gcp", "aws", "azure"]) {
    const filePath = path.join(pricingDir, `${cloud}.json`);
    pricingByCloud[cloud] = JSON.parse(await fs.readFile(filePath, "utf8"));
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

main().catch((error) => {
  console.error("Failed to regenerate explanation snapshots.");
  console.error(error);
  process.exit(1);
});
