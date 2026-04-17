import { defineJsonSecret } from "firebase-functions/params";

export const cloudOrder = ["gcp", "aws", "azure"];
export const sizeOrder = ["xs", "s", "m", "l", "xl"];
export const termOrder = ["on-demand", "1yr", "3yr"];

// Keep the custom runtime settings in one Secret Manager JSON blob so deploys
// and local emulation read the same shape.
export const runtimeConfigSecret = defineJsonSecret("CLOUDESTIMATE_RUNTIME_CONFIG");

export const cloudMeta = {
  gcp: {
    defaultRegion: "us-central1",
    loadBalancerMonthlyUsd: 18
  },
  aws: {
    defaultRegion: "us-east-1",
    loadBalancerMonthlyUsd: 16
  },
  azure: {
    defaultRegion: "eastus",
    loadBalancerMonthlyUsd: 18
  }
};

export const providerTargets = {
  gcp: {
    regions: ["us-central1", "us-east1"],
    storagePatterns: {
      ssd: { include: [/SSD backed PD Capacity/i] },
      hdd: { include: [/\bPD Capacity\b/i], exclude: [/SSD/i, /Hyperdisk/i, /Balanced/i] },
      nvme: { include: [/Hyperdisk Balanced Capacity/i] },
      object: { include: [/Standard Storage/i] }
    }
  },
  aws: {
    regions: ["us-east-1", "us-west-2"],
    regionLabels: {
      "us-east-1": "US East (N. Virginia)",
      "us-west-2": "US West (Oregon)"
    },
    storageProducts: {
      ssd: { serviceCode: "AmazonEC2", matcher: (product) => product.attributes?.volumeApiName === "gp3" },
      hdd: { serviceCode: "AmazonEC2", matcher: (product) => product.attributes?.volumeApiName === "st1" },
      nvme: { serviceCode: "AmazonEC2", matcher: (product) => product.attributes?.volumeApiName === "io2" },
      object: {
        serviceCode: "AmazonS3",
        matcher: (product) =>
          product.attributes?.storageClass === "General Purpose" &&
          product.attributes?.usagetype?.includes("TimedStorage-ByteHrs")
      }
    }
  },
  azure: {
    regions: ["eastus", "westus3"]
  }
};

export function getRuntimeConfig() {
  const config = runtimeConfigSecret.value();

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("CLOUDESTIMATE_RUNTIME_CONFIG must be a JSON object.");
  }

  return {
    cacheBucket: requireRuntimeValue(config, "CLOUDESTIMATE_CACHE_BUCKET"),
    googleCloudLocation: optionalRuntimeValue(config, "GOOGLE_CLOUD_LOCATION") ?? "global",
    vertexModel: optionalRuntimeValue(config, "CLOUDESTIMATE_VERTEX_MODEL") ?? "gemini-2.5-pro",
    githubOwner: requireRuntimeValue(config, "CLOUDESTIMATE_GITHUB_OWNER"),
    githubRepo: requireRuntimeValue(config, "CLOUDESTIMATE_GITHUB_REPO"),
    githubToken: requireRuntimeValue(config, "CLOUDESTIMATE_GITHUB_TOKEN")
  };
}

export function requireProcessEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function requireRuntimeValue(config, name) {
  const value = optionalRuntimeValue(config, name);

  if (!value) {
    throw new Error(`Missing required Cloud Functions runtime config value: ${name}`);
  }

  return value;
}

function optionalRuntimeValue(config, name) {
  const rawValue = config[name];

  if (rawValue == null) {
    return undefined;
  }

  if (typeof rawValue !== "string") {
    throw new Error(`Cloud Functions runtime config value ${name} must be a string.`);
  }

  const normalizedValue = rawValue.trim();
  return normalizedValue || undefined;
}
