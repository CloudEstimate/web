import { cloudMeta, siteConfig, type CloudSlug } from "@/lib/site";
import { formatCurrency, formatDate, formatUserRange } from "@/lib/format";
import type { EstimateResult, IsvEntry } from "@/lib/types";

export function buildCanonical(pathname: string) {
  return new URL(pathname, siteConfig.url).toString();
}

export function buildEstimateTitle(isv: IsvEntry, cloud: CloudSlug) {
  return `Size ${isv.data.name} on ${cloudMeta[cloud].name} | CloudEstimate`;
}

export function buildEstimateDescription(isv: IsvEntry, cloud: CloudSlug, estimate: EstimateResult) {
  return `${isv.data.name} on ${cloudMeta[cloud].name}: ${estimate.sizeLabel} sizing for ${formatUserRange(
    estimate.sizeDescription
  )}. ${formatCurrency(estimate.monthlyTotal)}/month based on reference architecture ${estimate.refArchTier}. Pricing snapshot ${formatDate(
    estimate.pricingSnapshotDate
  )}.`;
}

export function buildCompareTitle(isv: IsvEntry) {
  return `Compare ${isv.data.name} across clouds | CloudEstimate`;
}

export function buildCompareDescription(isv: IsvEntry, estimate: EstimateResult) {
  return `Compare ${isv.data.name} across Google Cloud, AWS, and Azure. Default ${estimate.sizeLabel.toLowerCase()} estimate from ${formatCurrency(
    estimate.monthlyTotal
  )}/month with dated source citations.`;
}

export function buildJsonLd(args: {
  title: string;
  description: string;
  canonical: string;
  image: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: args.title,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description: args.description,
    url: args.canonical,
    image: args.image,
    isAccessibleForFree: true,
    author: {
      "@type": "Person",
      name: siteConfig.owner.name,
      url: siteConfig.owner.site
    }
  };
}
