import { getCollection } from "astro:content";
import { buildEstimate, getDefaultRegion, getDefaultSize, getRegionsForCloud } from "@/lib/estimates";
import { buildCanonical } from "@/lib/seo";
import { categoryLabels, cloudMeta, cloudOrder, precomputedAI, regionLabels, siteConfig } from "@/lib/site";

export async function GET() {
  const isvs = (await getCollection("isvs")).sort((left, right) =>
    left.data.name.localeCompare(right.data.name)
  );

  const samplePricingDate =
    isvs.length > 0
      ? buildEstimate({
          isv: isvs[0],
          cloud: "gcp",
          size: getDefaultSize(isvs[0]),
          ha: false,
          term: "on-demand",
          region: getDefaultRegion("gcp")
        }).pricingSnapshotDate
      : null;

  const payload = {
    schema_version: "1.0",
    name: siteConfig.name,
    pattern: precomputedAI.name,
    citation: precomputedAI.citation,
    site_url: siteConfig.url,
    pricing_snapshot_date: samplePricingDate,
    clouds: Object.fromEntries(
      cloudOrder.map((cloud) => [
        cloud,
        {
          name: cloudMeta[cloud].name,
          default_region: getDefaultRegion(cloud),
          regions: getRegionsForCloud(cloud).map((code) => ({
            code,
            label: regionLabels[code] ?? code
          }))
        }
      ])
    ),
    isv_count: isvs.length,
    workloads: isvs.map((isv) => {
      const defaultSize = getDefaultSize(isv);
      const defaultMonthlyUsd = Object.fromEntries(
        cloudOrder.map((cloud) => {
          const estimate = buildEstimate({
            isv,
            cloud,
            size: defaultSize,
            ha: false,
            term: "on-demand",
            region: getDefaultRegion(cloud)
          });
          return [cloud, estimate.monthlyTotal];
        })
      );

      return {
        slug: isv.data.slug,
        name: isv.data.name,
        vendor: isv.data.vendor,
        category: isv.data.category,
        category_label: categoryLabels[isv.data.category] ?? isv.data.category,
        arch_support: isv.data.arch_support ?? ["x86_64"],
        description: isv.data.description.trim(),
        ref_arch: isv.data.ref_arch,
        available_sizes: Object.keys(isv.data.sizes),
        default_size: defaultSize,
        default_on_demand_monthly_usd: defaultMonthlyUsd,
        urls: {
          compare: buildCanonical(`/sizing/${isv.data.slug}/compare`),
          gcp: buildCanonical(`/sizing/${isv.data.slug}/gcp`),
          aws: buildCanonical(`/sizing/${isv.data.slug}/aws`),
          azure: buildCanonical(`/sizing/${isv.data.slug}/azure`),
          api: buildCanonical(`/api/v1/estimates/${isv.data.slug}.json`)
        }
      };
    })
  };

  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

