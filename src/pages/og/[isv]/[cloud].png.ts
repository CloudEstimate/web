import { getCollection } from "astro:content";
import { buildEstimate, getDefaultRegion, getDefaultSize } from "@/lib/estimates";
import { formatCurrency } from "@/lib/format";
import { renderOgPng } from "@/lib/og";
import { cloudOrder, cloudMeta, type CloudSlug } from "@/lib/site";
import type { IsvEntry } from "@/lib/types";

export async function getStaticPaths() {
  const isvs = await getCollection("isvs");
  return isvs.flatMap((isv) =>
    cloudOrder.map((cloud) => ({
      params: {
        isv: isv.data.slug,
        cloud
      },
      props: {
        isv,
        cloud
      }
    }))
  );
}

export function GET({ props }: { props: { isv: IsvEntry; cloud: CloudSlug } }) {
  const { isv, cloud } = props;
  const estimate = buildEstimate({
    isv,
    cloud,
    size: getDefaultSize(isv),
    ha: false,
    term: "on-demand",
    region: getDefaultRegion(cloud)
  });

  return new Response(
    new Uint8Array(renderOgPng({
      title: isv.data.name,
      subtitle: `${cloudMeta[cloud].name} · ${estimate.sizeLabel}`,
      costLabel: `${formatCurrency(estimate.monthlyTotal)}/month`,
      accent: cloudMeta[cloud].accent
    })),
    {
      headers: {
        "Content-Type": "image/png"
      }
    }
  );
}
