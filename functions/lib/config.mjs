export const cloudOrder = ["gcp", "aws", "azure"];
export const sizeOrder = ["xs", "s", "m", "l", "xl"];
export const termOrder = ["on-demand", "1yr", "3yr"];

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
    regions: ["us-central1", "us-east1", "europe-west1", "asia-southeast1"],
    storagePatterns: {
      ssd: {
        include: [/Balanced PD Capacity/i],
        exclude: [/Regional/i, /Confidential/i, /Hyperdisk/i, /Replication/i, /Snapshot/i]
      },
      hdd: {
        include: [/\bPD Capacity\b/i],
        exclude: [/SSD/i, /Hyperdisk/i, /Balanced/i, /Extreme/i, /Regional/i, /Confidential/i, /Snapshot/i]
      },
      nvme: {
        include: [/SSD backed PD Capacity/i],
        exclude: [/Regional/i, /Confidential/i, /Snapshot/i]
      },
      object: {
        include: [/^Standard Storage/i],
        exclude: [/Dual-region/i, /Multi-region/i, /Autoclass/i, /Tag/i, /Replication/i]
      }
    }
  },
  aws: {
    regions: ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"],
    regionLabels: {
      "us-east-1": "US East (N. Virginia)",
      "us-west-2": "US West (Oregon)",
      "eu-west-1": "EU (Ireland)",
      "ap-southeast-1": "Asia Pacific (Singapore)"
    },
    storageProducts: {
      ssd: {
        serviceCode: "AmazonEC2",
        matcher: (product) =>
          product.attributes?.volumeApiName === "gp3" && product.attributes?.usagetype?.includes("VolumeUsage")
      },
      hdd: {
        serviceCode: "AmazonEC2",
        matcher: (product) =>
          product.attributes?.volumeApiName === "st1" && product.attributes?.usagetype?.includes("VolumeUsage")
      },
      nvme: {
        serviceCode: "AmazonEC2",
        matcher: (product) =>
          product.attributes?.volumeApiName === "io2" && product.attributes?.usagetype?.includes("VolumeUsage")
      },
      object: {
        serviceCode: "AmazonS3",
        matcher: (product) =>
          product.attributes?.storageClass === "General Purpose" &&
          product.attributes?.usagetype?.includes("TimedStorage-ByteHrs")
      }
    }
  },
  azure: {
    regions: ["eastus", "westus3", "westeurope", "southeastasia"]
  }
};

export function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function requireProjectId() {
  const projectId = resolveProjectId();

  if (!projectId) {
    throw new Error("Missing required Google Cloud project ID environment variable.");
  }

  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    process.env.GOOGLE_CLOUD_PROJECT = projectId;
  }

  return projectId;
}

export function resolveProjectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.CLOUDESTIMATE_GCP_PROJECT_ID ||
    readProjectIdFromFirebaseConfig()
  );
}

function readProjectIdFromFirebaseConfig() {
  const raw = process.env.FIREBASE_CONFIG;

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw).projectId ?? null;
  } catch {
    return null;
  }
}
