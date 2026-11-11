import { getCollection } from "astro:content";
import { buildCompareMatrix, buildEstimateMatrix, getDefaultRegion, getDefaultSize, getRegionsForCloud } from "@/lib/estimates";
import { getCompareExplanationWithMetadata, getSizingExplanationWithMetadata } from "@/lib/explanations";
import { buildCanonical } from "@/lib/seo";
import { categoryLabels, cloudOrder } from "@/lib/site";
import type { IsvEntry } from "@/lib/types";

export async function getStaticPaths() {
  const isvs = await getCollection("isvs");
  return isvs.map((isv) => ({
    params: { isv: isv.data.slug },
    props: { isv }
  }));
}

export function GET({ props }: { props: { isv: IsvEntry } }) {
  const { isv } = props;
  const compareMatrix = buildCompareMatrix(isv);

  const singleCloudEstimates = Object.fromEntries(
    cloudOrder.map((cloud) => {
      const matrix = buildEstimateMatrix(isv, cloud);
      const entries = Object.fromEntries(
        Object.entries(matrix).map(([key, estimate]) => {
          const [, size, haKey, term, region] = key.split(":");
          const ha = haKey === "ha";
          const explanationMeta = getSizingExplanationWithMetadata({
            isv,
            cloud,
            size,
            region,
            term,
            ha,
            estimate
          });

          return [
            key,
            {
              size,
              ha,
              term,
              region,
              estimate,
              explanation: explanationMeta.explanation,
              explanation_source: explanationMeta.source
            }
          ];
        })
      );

      return [
        cloud,
        {
          default_region: getDefaultRegion(cloud),
          regions: getRegionsForCloud(cloud),
          states: entries
        }
      ];
    })
  );

  const compareStates = Object.fromEntries(
    Object.entries(compareMatrix).map(([key, view]) => {
      const explanationMeta = getCompareExplanationWithMetadata({
        isv,
        size: view.size,
        sizeLabel: isv.data.sizes[view.size]?.label ?? view.size.toUpperCase(),
        rangeDescription: isv.data.sizes[view.size]?.range_description ?? "",
        term: view.term,
        ha: view.ha,
        estimates: view.estimates
      });

      return [
        key,
        {
          size: view.size,
          ha: view.ha,
          term: view.term,
          regions: view.regions,
          monthly_totals_usd: {
            gcp: view.estimates.gcp.monthlyTotal,
            aws: view.estimates.aws.monthlyTotal,
            azure: view.estimates.azure.monthlyTotal
          },
          explanation: explanationMeta.explanation,
          explanation_source: explanationMeta.source
        }
      ];
    })
  );

  const payload = {
    schema_version: "1.0",
    slug: isv.data.slug,
    name: isv.data.name,
    vendor: isv.data.vendor,
    category: isv.data.category,
    category_label: categoryLabels[isv.data.category] ?? isv.data.category,
    arch_support: isv.data.arch_support ?? ["x86_64"],
    description: isv.data.description.trim(),
    default_size: getDefaultSize(isv),
    ref_arch: isv.data.ref_arch,
    notes: isv.data.notes,
    disclaimers: isv.data.disclaimers,
    urls: {
      compare: buildCanonical(`/sizing/${isv.data.slug}/compare`),
      gcp: buildCanonical(`/sizing/${isv.data.slug}/gcp`),
      aws: buildCanonical(`/sizing/${isv.data.slug}/aws`),
      azure: buildCanonical(`/sizing/${isv.data.slug}/azure`)
    },
    compare: compareStates,
    clouds: singleCloudEstimates
  };

  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

