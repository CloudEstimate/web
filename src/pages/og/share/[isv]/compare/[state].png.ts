import { getCollection } from "astro:content";
import { buildCompareMatrix } from "@/lib/estimates";
import { formatCurrency } from "@/lib/format";
import { renderOgPng } from "@/lib/og";
import { decodeCompareShareState, encodeCompareShareState } from "@/lib/share";
import type { IsvEntry } from "@/lib/types";

export async function getStaticPaths() {
  const isvs = await getCollection("isvs");
  return isvs.flatMap((isv) => {
    const states = [];

    for (const size of ["xs", "s", "m", "l", "xl"] as const) {
      if (!isv.data.sizes[size]) {
        continue;
      }

      for (const ha of [false, true]) {
        for (const term of ["on-demand", "1yr", "3yr"] as const) {
          states.push({
            params: {
              isv: isv.data.slug,
              state: encodeCompareShareState({ size, ha, term })
            },
            props: {
              isv,
              state: { size, ha, term }
            }
          });
        }
      }
    }

    return states;
  });
}

export function GET({ props }: { props: { isv: IsvEntry; state: ReturnType<typeof decodeCompareShareState> } }) {
  const { isv, state } = props;
  const compareView = buildCompareMatrix(isv)[`${state.size}:${state.ha ? "ha" : "noha"}:${state.term}`];
  const cheapest = Object.values(compareView.estimates).sort((left, right) => left.monthlyTotal - right.monthlyTotal)[0];

  return new Response(
    new Uint8Array(
      renderOgPng({
        title: `${isv.data.name}`,
        subtitle: `Google Cloud · AWS · Azure · ${state.size.toUpperCase()}`,
        costLabel: `${formatCurrency(cheapest.monthlyTotal)}/month`,
        accent: "#575d8d"
      })
    ),
    {
      headers: {
        "Content-Type": "image/png"
      }
    }
  );
}
