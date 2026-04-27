import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { dispatchRebuild } from "./lib/rebuild.mjs";
import { resolveProjectId } from "./lib/config.mjs";

ensureGoogleCloudProjectEnv();

setGlobalOptions({
  region: "us-central1",
  timeoutSeconds: 540,
  memory: "2GiB"
});

export const triggerRebuild = onRequest(async (_request, response) => {
  ensureGoogleCloudProjectEnv();
  await dispatchRebuild("manual-trigger");
  response.status(202).json({ ok: true });
});

function ensureGoogleCloudProjectEnv() {
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    const resolvedProjectId = resolveProjectId();

    if (resolvedProjectId) {
      process.env.GOOGLE_CLOUD_PROJECT = resolvedProjectId;
    }
  }
}
