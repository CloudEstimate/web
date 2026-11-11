import singleExplanationCache from "@/data/generated/explanations/single.json";
import compareExplanationCache from "@/data/generated/explanations/compare.json";
import { cloudMeta, cloudOrder, type CloudSlug } from "@/lib/site";
import { formatCurrency, formatPercent, formatRoleLabel, formatStorage } from "@/lib/format";
import type { EstimateResult, ExplanationCacheEntry, IsvEntry } from "@/lib/types";

const singleCache = singleExplanationCache as Record<string, ExplanationCacheEntry>;
const compareCache = compareExplanationCache as Record<string, ExplanationCacheEntry>;

export type ExplanationSource = "precomputed_cache" | "deterministic_fallback";

export type ExplanationWithMetadata = {
  explanation: string;
  source: ExplanationSource;
  generatedAt: string | null;
  generatedDate: string | null;
  model: string | null;
};

type SizingExplanationArgs = {
  isv: IsvEntry;
  cloud: CloudSlug;
  size: string;
  region: string;
  term: string;
  ha: boolean;
  estimate: EstimateResult;
};

type CompareExplanationArgs = {
  isv: IsvEntry;
  size: string;
  sizeLabel: string;
  rangeDescription: string;
  term: string;
  ha: boolean;
  estimates: Record<CloudSlug, EstimateResult>;
};

function dominantLineItem(estimate: EstimateResult) {
  const items = [
    { label: "Compute", value: estimate.computeTotal },
    { label: "Storage", value: estimate.storageTotal },
    { label: "Other", value: estimate.otherTotal }
  ].sort((left, right) => right.value - left.value);

  return items[0];
}

export function getSizingExplanation(args: SizingExplanationArgs) {
  return getSizingExplanationWithMetadata(args).explanation;
}

export function getSizingExplanationWithMetadata(args: SizingExplanationArgs): ExplanationWithMetadata {
  if (args.term !== "on-demand") {
    return buildFallbackMetadata(buildSizingExplanationFallback(args));
  }

  const key = buildSingleKey(args);
  const cached = singleCache[key];

  if (cached?.explanation) {
    return buildCacheMetadata(cached);
  }

  return buildFallbackMetadata(buildSizingExplanationFallback(args));
}

export function getCompareExplanation(args: CompareExplanationArgs) {
  return getCompareExplanationWithMetadata(args).explanation;
}

export function getCompareExplanationWithMetadata(args: CompareExplanationArgs): ExplanationWithMetadata {
  const key = buildCompareKey(args);
  const cached = compareCache[key];

  if (cached?.explanation) {
    return buildCacheMetadata(cached);
  }

  return buildFallbackMetadata(buildCompareExplanationFallback(args));
}

export function buildSingleKey(args: {
  isv: IsvEntry;
  cloud: CloudSlug;
  size: string;
  region: string;
  ha: boolean;
}) {
  return [args.isv.data.slug, args.cloud, args.size, args.ha ? "ha" : "noha", args.region].join(":");
}

export function buildCompareKey(args: {
  isv: IsvEntry;
  size: string;
  term: string;
  ha: boolean;
}) {
  return [
    args.isv.data.slug,
    args.size,
    args.ha ? "ha" : "noha",
    args.term
  ].join(":");
}

export function buildSizingExplanationFallback(args: {
  isv: IsvEntry;
  cloud: CloudSlug;
  size: string;
  region: string;
  term: string;
  ha: boolean;
  estimate: EstimateResult;
}) {
  const { isv, cloud, region, term, ha, estimate } = args;
  const dominant = dominantLineItem(estimate);
  const share = estimate.monthlyTotal > 0 ? (dominant.value / estimate.monthlyTotal) * 100 : 0;
  const biggestStorageFootprint = [...estimate.components].sort((left, right) => right.storageGb - left.storageGb)[0];
  const commitmentSavings =
    term === "on-demand"
      ? null
      : estimate.components.length > 0 && estimate.onDemandComputeTotal > 0
        ? buildCommitmentSentence(term, estimate)
        : null;

  const haSentence = !estimate.haAddsComponents
    ? `This tier already provisions multi-node quorum or replication in its baseline topology, so enabling high availability adds no extra nodes.`
    : ha
      ? `High availability is enabled here, adding redundant failover capacity across the application, data, or ingress tiers.`
      : `High availability is not included here, keeping this baseline footprint lean without standby failover nodes.`;

  const fourthSentence = commitmentSavings
    ? commitmentSavings
    : biggestStorageFootprint?.storageGb
      ? `${formatRoleLabel(biggestStorageFootprint.role)} carries the heaviest storage footprint at ${formatStorage(biggestStorageFootprint.storageGb)}${
          biggestStorageFootprint.count > 1 ? ` on each of its ${biggestStorageFootprint.count} nodes` : ""
        }.`
      : `This tier is primarily a compute sizing exercise rather than a storage-heavy deployment.`;

  return [
    `${isv.data.name} at the ${estimate.sizeLabel.toLowerCase()} tier maps to the ${estimate.refArchTier} reference architecture on ${cloudMeta[cloud].name} in ${region}.`,
    `${dominant.label} is the largest line item in this estimate, accounting for ${formatPercent(share)} of monthly cost.`,
    haSentence,
    fourthSentence
  ].join(" ");
}

export function buildCompareExplanationFallback(args: {
  isv: IsvEntry;
  size: string;
  sizeLabel: string;
  rangeDescription: string;
  term: string;
  ha: boolean;
  estimates: Record<CloudSlug, EstimateResult>;
}) {
  const ranked = cloudOrder
    .map((cloud) => ({
      cloud,
      total: args.estimates[cloud].monthlyTotal
    }))
    .sort((left, right) => left.total - right.total);

  const cheapest = ranked[0];
  const priciest = ranked.at(-1) ?? ranked[0];
  const delta = priciest.total - cheapest.total;
  const second = ranked[1];
  const midpointDelta = second ? second.total - cheapest.total : 0;

  const sentences = [
    `${cloudMeta[cheapest.cloud].name} is the lowest-cost option for ${args.isv.data.name} at the ${args.sizeLabel.toLowerCase()} tier, landing ${formatCurrency(delta)} per month below ${cloudMeta[priciest.cloud].name}.`,
    args.term === "on-demand"
      ? `This spread comes from VM and block/object storage list pricing in the default regions rather than commitment discounts.`
      : `${args.term} commitments compress compute spend across all three clouds while preserving the relative ranking of matched VM families and storage rates.`,
    args.ha
      ? `With high availability enabled, duplicated stateful tiers widen regional price differences to ${formatCurrency(midpointDelta)} per month between the first and second cloud options.`
      : `Without high availability, totals stay closer together across clouds, though existing enterprise commitments or hybrid licensing discounts can still shift the procurement outcome.`
  ];

  return sentences.join(" ");
}

function buildCommitmentSentence(term: string, estimate: EstimateResult) {
  const baseline = estimate.onDemandComputeTotal;
  const savings = baseline > 0 ? Math.max(0, ((baseline - estimate.computeTotal) / baseline) * 100) : 0;

  return `${term} commitment pricing cuts compute spend by ${formatPercent(savings)} against on-demand rates in this region.`;
}

function buildCacheMetadata(entry: ExplanationCacheEntry): ExplanationWithMetadata {
  return {
    explanation: entry.explanation,
    source: "precomputed_cache",
    generatedAt: entry.generated_at,
    generatedDate: entry.generated_at.slice(0, 10),
    model: entry.model
  };
}

function buildFallbackMetadata(explanation: string): ExplanationWithMetadata {
  return {
    explanation,
    source: "deterministic_fallback",
    generatedAt: null,
    generatedDate: null,
    model: null
  };
}
