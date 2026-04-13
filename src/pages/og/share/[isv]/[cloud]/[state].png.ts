import { getCollection } from "astro:content";
import { buildEstimate, getRegionsForCloud } from "@/lib/estimates";
import { formatCurrency } from "@/lib/format";
import { renderOgPng } from "@/lib/og";
import { decodeEstimateShareState, encodeEstimateShareState } from "@/lib/share";
import { cloudOrder, cloudMeta, type CloudSlug } from "@/lib/site";
import type { IsvEntry } from "@/lib/types";

export async function getStaticPaths() {
  const isvs = await getCollection("isvs");

  return isvs.flatMap((isv) =>
    cloudOrder.flatMap((cloud) => {
      const states = [];

      for (const size of ["xs", "s", "m", "l", "xl"] as const) {
        if (!isv.data.sizes[size]) {
          continue;
        }

        for (const ha of [false, true]) {
          for (const term of ["on-demand", "1yr", "3yr"] as const) {
            for (const region of getRegionsForCloud(cloud)) {
              states.push({
                params: {
                  isv: isv.data.slug,
                  cloud,
                  state: encodeEstimateShareState({ size, ha, term, region })
                },
                props: {
                  isv,
                  cloud,
                  state: { size, ha, term, region }
                }
              });
            }
          }
        }
      }

      return states;
    })
  );
}

export function GET({ props }: { props: { isv: IsvEntry; cloud: CloudSlug; state: ReturnType<typeof decodeEstimateShareState> } }) {
  const { isv, cloud, state } = props;
  const estimate = buildEstimate({
    isv,
    cloud,
    size: state.size,
    ha: state.ha,
    term: state.term,
    region: state.region
  });

  return new Response(
    new Uint8Array(
      renderOgPng({
        title: isv.data.name,
        subtitle: `${cloudMeta[cloud].name} · ${estimate.sizeLabel} · ${state.region}`,
        costLabel: `${formatCurrency(estimate.monthlyTotal)}/month`,
        accent: cloudMeta[cloud].accent
      })
    ),
    {
      headers: {
        "Content-Type": "image/png"
      }
    }
  );
}
