export const siteConfig = {
  name: "CloudEstimate",
  url: import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321",
  description:
    "Reference-architecture-based sizing and monthly cost estimates for Google Cloud, AWS, and Azure.",
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
