import { resolveSiteUrl } from "@/lib/site-url";

const isProductionBuild =
  process.env.CI === "true" || process.env.npm_lifecycle_event === "build" || process.argv.includes("build");

export const precomputedAI = {
  name: "Precomputed AI",
  url: "https://precomputedai.com",
  repository: "https://github.com/PrecomputedAI/precomputed-ai",
  description:
    "An artifact-first LLM design pattern for precomputing reusable reasoning, serving through versioned artifacts, and escalating only through declared paths.",
  citation:
    "Raquedan, R. (2026). Precomputed AI: Reason Ahead of Time, Serve Instantly.",
  citationUrl: "https://precomputedai.com"
} as const;

export const siteConfig = {
  name: "CloudEstimate",
  url: resolveSiteUrl(import.meta.env.PUBLIC_SITE_URL, !isProductionBuild),
  description:
    "A worked example of the Precomputed AI design pattern for reference-architecture-based cloud sizing and monthly cost estimates.",
  owner: {
    name: "Regnard Raquedan",
    site: "https://regnard.raquedan.com",
    linkedIn: "https://linkedin.com/in/raquedan",
    gde: "https://developers.google.com/community/experts/directory/profile/profile-regnard-raquedan",
    github: "https://github.com/CloudEstimate/web"
  },
  nav: [
    { href: "/isvs", label: "ISVs" },
    { href: "/methodology", label: "Methodology" },
    { href: "/about", label: "About" }
  ],
  footerMiddle: [
    { href: "/methodology", label: "Methodology" },
    { href: "/changelog", label: "Changelog" },
    { href: "/acknowledgements", label: "Acknowledgements" }
  ],
  footerRight: [
    { href: "/terms", label: "Terms" },
    { href: "/privacy", label: "Privacy" }
  ]
} as const;

export const cloudMeta = {
  gcp: {
    slug: "gcp",
    name: "Google Cloud",
    shortName: "Google Cloud",
    accent: "#575d8d",
    defaultRegion: "us-central1",
    calculatorLabel: "Google Cloud Pricing Calculator",
    calculatorUrl: "https://cloud.google.com/products/calculator"
  },
  aws: {
    slug: "aws",
    name: "AWS",
    shortName: "AWS",
    accent: "#b78d16",
    defaultRegion: "us-east-1",
    calculatorLabel: "AWS Pricing Calculator",
    calculatorUrl: "https://calculator.aws"
  },
  azure: {
    slug: "azure",
    name: "Azure",
    shortName: "Azure",
    accent: "#7d82b8",
    defaultRegion: "eastus",
    calculatorLabel: "Azure Pricing Calculator",
    calculatorUrl: "https://azure.microsoft.com/pricing/calculator/"
  }
} as const;

export const cloudOrder = ["gcp", "aws", "azure"] as const;
export const sizeOrder = ["xs", "s", "m", "l", "xl"] as const;
export const termOrder = ["on-demand", "1yr", "3yr"] as const;

export type CloudSlug = keyof typeof cloudMeta;
export type SizeSlug = (typeof sizeOrder)[number];
export type CommitmentTerm = (typeof termOrder)[number];
