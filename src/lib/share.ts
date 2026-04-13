import { type CloudSlug, type CommitmentTerm, type SizeSlug } from "@/lib/site";

export function encodeEstimateShareState(state: {
  size: SizeSlug;
  ha: boolean;
  term: CommitmentTerm;
  region: string;
}) {
  return [`size-${state.size}`, `ha-${state.ha ? "true" : "false"}`, `term-${state.term}`, `region-${state.region}`].join("__");
}

export function decodeEstimateShareState(token: string) {
  const parts = Object.fromEntries(
    token.split("__").map((part) => {
      const [key, ...rest] = part.split("-");
      return [key, rest.join("-")];
    })
  );

  return {
    size: (parts.size ?? "m") as SizeSlug,
    ha: parts.ha === "true",
    term: (parts.term ?? "on-demand") as CommitmentTerm,
    region: parts.region ?? ""
  };
}

export function encodeCompareShareState(state: {
  size: SizeSlug;
  ha: boolean;
  term: CommitmentTerm;
}) {
  return [`size-${state.size}`, `ha-${state.ha ? "true" : "false"}`, `term-${state.term}`].join("__");
}

export function decodeCompareShareState(token: string) {
  const parts = Object.fromEntries(
    token.split("__").map((part) => {
      const [key, ...rest] = part.split("-");
      return [key, rest.join("-")];
    })
  );

  return {
    size: (parts.size ?? "m") as SizeSlug,
    ha: parts.ha === "true",
    term: (parts.term ?? "on-demand") as CommitmentTerm
  };
}

export function buildEstimateQuery(state: {
  size: SizeSlug;
  ha: boolean;
  term: CommitmentTerm;
  region: string;
}) {
  const params = new URLSearchParams();
  params.set("size", state.size);
  params.set("ha", String(state.ha));
  params.set("term", state.term);
  params.set("region", state.region);
  return params.toString();
}

export function buildEstimateSharePath(slug: string, cloud: CloudSlug, state: {
  size: SizeSlug;
  ha: boolean;
  term: CommitmentTerm;
  region: string;
}) {
  return `/share/${slug}/${cloud}/${encodeEstimateShareState(state)}`;
}

export function buildCompareSharePath(slug: string, state: {
  size: SizeSlug;
  ha: boolean;
  term: CommitmentTerm;
}) {
  return `/share/${slug}/compare/${encodeCompareShareState(state)}`;
}
