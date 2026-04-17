import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { logger } from "firebase-functions/v2";
import { requireEnv } from "./config.mjs";

const secretManager = new SecretManagerServiceClient();
let cachedGitHubToken = null;

export async function dispatchRebuild(reason) {
  const owner = requireEnv("CLOUDESTIMATE_GITHUB_OWNER");
  const repo = requireEnv("CLOUDESTIMATE_GITHUB_REPO");
  const token = await getGitHubToken();
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

async function getGitHubToken() {
  if (cachedGitHubToken) {
    return cachedGitHubToken;
  }

  const projectId = requireEnv("GOOGLE_CLOUD_PROJECT");
  const [version] = await secretManager.accessSecretVersion({
    name: `projects/${projectId}/secrets/CLOUDESTIMATE_GITHUB_TOKEN/versions/latest`
  });
  const token = version.payload?.data?.toString("utf8").trim();

  if (!token) {
    throw new Error("Secret Manager returned an empty CLOUDESTIMATE_GITHUB_TOKEN payload.");
  }

  cachedGitHubToken = token;
  return cachedGitHubToken;
}
