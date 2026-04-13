import singleExplanationCache from "@/data/generated/explanations/single.json";
import compareExplanationCache from "@/data/generated/explanations/compare.json";
import { cloudMeta, cloudOrder, type CloudSlug } from "@/lib/site";
import { formatCurrency, formatPercent, formatRoleLabel, formatStorage } from "@/lib/format";
import type { EstimateResult, ExplanationCacheEntry, IsvEntry } from "@/lib/types";

const singleCache = singleExplanationCache as Record<string, ExplanationCacheEntry>;
const compareCache = compareExplanationCache as Record<string, ExplanationCacheEntry>;

function dominantLineItem(estimate: EstimateResult) {
  const items = [
    { label: "Compute", value: estimate.computeTotal },
    { label: "Storage", value: estimate.storageTotal },
    { label: "Other", value: estimate.otherTotal }
  ].sort((left, right) => right.value - left.value);

  return items[0];
}

export function getSizingExplanation(args: {
  isv: IsvEntry;
  cloud: CloudSlug;
  size: string;
  region: string;
  term: string;
  ha: boolean;
  estimate: EstimateResult;
}) {
  const key = buildSingleKey(args);
  return singleCache[key]?.explanation ?? buildSizingExplanationFallback(args);
}

export function getCompareExplanation(args: {
  isv: IsvEntry;
  size: string;
  sizeLabel: string;
  rangeDescription: string;
  term: string;
  ha: boolean;
  estimates: Record<CloudSlug, EstimateResult>;
}) {
  const key = buildCompareKey(args);
  return compareCache[key]?.explanation ?? buildCompareExplanationFallback(args);
}

export function buildSingleKey(args: {
  isv: IsvEntry;
  cloud: CloudSlug;
  size: string;
  region: string;
  term: string;
  ha: boolean;
}) {
  return [
    args.isv.data.slug,
    args.cloud,
    args.size,
    args.ha ? "ha" : "noha",
    args.term,
    args.region
  ].join(":");
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
      : estimate.components.length > 0
        ? buildCommitmentSentence(term, estimate)
        : null;

  const sentences = [
    `${isv.data.name} at the ${estimate.sizeLabel.toLowerCase()} tier maps to the ${estimate.refArchTier} reference architecture on ${cloudMeta[cloud].name} in ${region}.`,
    `${dominant.label} is the largest line item in this estimate, accounting for ${formatPercent(share)} of monthly cost.`,
    ha
      ? `High availability is enabled here, so the footprint carries duplicate capacity for failover across the application, data, or cache tiers.`
      : `High availability is not included here, so this baseline stays lean and leaves failover headroom out of the monthly total.`,
    biggestStorageFootprint?.storageGb
      ? `${formatRoleLabel(biggestStorageFootprint.role)} carries the heaviest storage footprint at ${formatStorage(biggestStorageFootprint.storageGb)}${
          biggestStorageFootprint.count > 1 ? ` on each of its ${biggestStorageFootprint.count} nodes` : ""
        }.${commitmentSavings ? ` ${commitmentSavings}` : ""}`
      : `This tier is primarily a compute sizing exercise rather than a storage-heavy one.${commitmentSavings ? ` ${commitmentSavings}` : ""}`
  ];

  return sentences.join(" ");
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
      ? `This spread comes from instance and storage pricing in the default regions rather than commitment discounts, so the ranking reflects straight commercial list pricing.`
      : `${args.term} commitments compress compute spend across all three clouds, but the ranking still follows the relative price of the matched VM families and storage rates.`,
    args.ha
      ? `With high availability enabled, the cost gap matters most in duplicated data tiers, where each extra node amplifies regional price differences by about ${formatCurrency(midpointDelta)} per month between the cheapest and middle option.`
      : `Without high availability, the totals stay closer together because there is less replicated capacity, but existing enterprise commitments or hybrid-use discounts could still change the real procurement outcome.`
  ];

  return sentences.join(" ");
}

function buildCommitmentSentence(term: string, estimate: EstimateResult) {
  const onDemandEquivalent =
    estimate.computeTotal /
    (term === "1yr" ? 0.724 : 0.538);
  const savings = onDemandEquivalent > 0 ? ((onDemandEquivalent - estimate.computeTotal) / onDemandEquivalent) * 100 : 0;

  return `${term} pricing cuts the compute portion by about ${formatPercent(savings)} against on-demand in this snapshot.`;
}
