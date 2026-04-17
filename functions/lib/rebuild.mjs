import { logger } from "firebase-functions/v2";
import { getRuntimeConfig } from "./config.mjs";

export async function dispatchRebuild(reason) {
  const { githubOwner: owner, githubRepo: repo, githubToken: token } = getRuntimeConfig();
  const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      event_type: "cache-updated",
      client_payload: {
        reason
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to dispatch GitHub rebuild: ${response.status} ${response.statusText}`);
  }

  logger.info(`Triggered GitHub rebuild for ${reason}.`);
}
