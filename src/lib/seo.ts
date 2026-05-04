import { cloudMeta, precomputedAI, siteConfig, type CloudSlug } from "@/lib/site";
import { formatCurrency, formatDate, formatUserRange } from "@/lib/format";
import type { EstimateResult, IsvEntry } from "@/lib/types";

export function buildCanonical(pathname: string) {
  return new URL(pathname, siteConfig.url).toString();
}

export function buildEstimateTitle(isv: IsvEntry, cloud: CloudSlug) {
  return `Self-Managed ${isv.data.name} Pricing & Sizing on ${cloudMeta[cloud].name} | CloudEstimate`;
}

export function buildEstimateDescription(isv: IsvEntry, cloud: CloudSlug, estimate: EstimateResult) {
  return `Self-managed ${isv.data.name} on ${cloudMeta[cloud].name}: ${estimate.sizeLabel} sizing for ${formatUserRange(
    estimate.sizeDescription
  )}. Monthly cost ${formatCurrency(estimate.monthlyTotal)} based on reference architecture ${estimate.refArchTier}. Pricing snapshot ${formatDate(
    estimate.pricingSnapshotDate
  )}.`;
}

export function buildCompareTitle(isv: IsvEntry) {
  return `Compare Self-Managed ${isv.data.name} Pricing on Google Cloud, AWS, and Azure | CloudEstimate`;
}

export function buildCompareDescription(isv: IsvEntry, estimate: EstimateResult) {
  return `Compare self-managed ${isv.data.name} on Google Cloud, AWS, and Azure. Default ${estimate.sizeLabel.toLowerCase()} view starts at ${formatCurrency(
    estimate.monthlyTotal
  )}/month with dated source citations.`;
}

type JsonLdObject = Record<string, unknown>;
type JsonLdType = "WebPage" | "WebSite" | "CollectionPage" | "AboutPage" | "TechArticle";

function buildAuthorJsonLd() {
  return {
    "@type": "Person",
    name: siteConfig.owner.name,
    url: siteConfig.owner.site
  };
}

function buildPublisherJsonLd() {
  return {
    "@type": "Organization",
    name: siteConfig.name,
    url: siteConfig.url
  };
}

export function buildPageJsonLd(args: {
  type?: JsonLdType;
  title: string;
  description: string;
  canonical: string;
  image?: string;
}) {
  const jsonLd: JsonLdObject = {
    "@context": "https://schema.org",
    "@type": args.type ?? "WebPage",
    name: args.title,
    headline: args.title,
    description: args.description,
    url: args.canonical,
    inLanguage: "en-CA",
    isAccessibleForFree: true,
    about: {
      "@type": "Thing",
      name: precomputedAI.name,
      url: precomputedAI.url,
      description: precomputedAI.description
    },
    citation: {
      "@type": "CreativeWork",
      name: precomputedAI.citation,
      url: precomputedAI.citationUrl
    },
    author: buildAuthorJsonLd(),
    publisher: buildPublisherJsonLd(),
    isBasedOn: {
      "@type": "CreativeWork",
      name: precomputedAI.citation,
      alternateName: precomputedAI.name,
      url: precomputedAI.citationUrl
    }
  };

  if (args.image) {
    jsonLd.image = args.image;
  }

  return jsonLd;
}

export function buildBreadcrumbJsonLd(items: Array<{ name: string; item: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.item
    }))
  };
}

export function buildItemListJsonLd(args: {
  name: string;
  description: string;
  items: Array<{ name: string; item: string }>;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: args.name,
    description: args.description,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: args.items.length,
    itemListElement: args.items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.item
    }))
  };
}

export function buildJsonLd(args: {
  title: string;
  description: string;
  canonical: string;
  image?: string;
}) {
  return buildPageJsonLd({
    title: args.title,
    description: args.description,
    canonical: args.canonical,
    image: args.image
  });
}

export function buildEstimateProductJsonLd(args: {
  title: string;
  description: string;
  canonical: string;
  image: string;
  price: number;
  lastModifiedDate: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: args.title,
    description: args.description,
    url: args.canonical,
    image: args.image,
    offers: {
      "@type": "Offer",
      price: args.price.toFixed(2),
      priceCurrency: "USD",
      availability: "https://schema.org/InStock"
    },
    dateModified: args.lastModifiedDate
  };
}
