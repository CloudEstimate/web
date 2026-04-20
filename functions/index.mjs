import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { dispatchRebuild } from "./lib/rebuild.mjs";
import { regenerateExplanationCaches } from "./lib/regenerate-explanations.mjs";
import { refreshPricingCaches } from "./lib/refresh-pricing.mjs";

setGlobalOptions({
  region: "us-central1",
  timeoutSeconds: 540,
  memory: "2GiB"
});

export const refreshPricing = onSchedule("0 2 * * *", async () => {
  await refreshPricingCaches();
  await dispatchRebuild("pricing-refreshed");
});

export const regenerateExplanations = onSchedule("0 3 * * *", async () => {
  await regenerateExplanationCaches();
  await dispatchRebuild("explanations-regenerated");
});

export const triggerRebuild = onRequest(async (_request, response) => {
  await dispatchRebuild("manual-trigger");
  response.status(202).json({ ok: true });
});
