import { getCollection } from "astro:content";
import { buildCompareMatrix, getDefaultSize } from "@/lib/estimates";
import { formatCurrency } from "@/lib/format";
import { renderOgPng } from "@/lib/og";
import type { IsvEntry } from "@/lib/types";

export async function getStaticPaths() {
  const isvs = await getCollection("isvs");
  return isvs.map((isv) => ({
    params: {
      isv: isv.data.slug
    },
    props: {
      isv
    }
  }));
}

export function GET({ props }: { props: { isv: IsvEntry } }) {
  const { isv } = props;
  const compare = buildCompareMatrix(isv);
  const estimate = compare[`${getDefaultSize(isv)}:noha:on-demand`].estimates.gcp;

  return new Response(
    new Uint8Array(renderOgPng({
      title: isv.data.name,
      subtitle: "Google Cloud · AWS · Azure",
      costLabel: `${formatCurrency(estimate.monthlyTotal)}/month`,
      accent: "#575d8d"
    })),
    {
      headers: {
        "Content-Type": "image/png"
      }
    }
  );
}
