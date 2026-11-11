import { timingSafeEqual } from "node:crypto";
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

export const triggerRebuild = onRequest(
  { invoker: "private" },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    const expectedToken = process.env.CLOUDESTIMATE_REBUILD_TOKEN?.trim();
    if (expectedToken) {
      const authHeader = request.get("authorization") || "";
      const providedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const expectedBuf = Buffer.from(expectedToken, "utf8");
      const providedBuf = Buffer.from(providedToken, "utf8");
      if (
        expectedBuf.length !== providedBuf.length ||
        !timingSafeEqual(expectedBuf, providedBuf)
      ) {
        response.status(401).json({ ok: false, error: "Unauthorized" });
        return;
      }
    }

    ensureGoogleCloudProjectEnv();
    await dispatchRebuild("manual-trigger");
    response.status(202).json({ ok: true });
  }
);

function ensureGoogleCloudProjectEnv() {
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    const resolvedProjectId = resolveProjectId();

    if (resolvedProjectId) {
      process.env.GOOGLE_CLOUD_PROJECT = resolvedProjectId;
    }
  }
}
