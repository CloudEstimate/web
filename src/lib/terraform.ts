import { type CloudSlug, cloudMeta } from "@/lib/site";
import type { EstimateResult } from "@/lib/types";
import { buildGcpTerraformSnippet } from "../../shared/terraform-core.mjs";

export function buildTerraformSnippet(args: {
  slug: string;
  cloud: CloudSlug;
  region: string;
  estimate: EstimateResult;
}) {
  if (args.cloud !== "gcp") {
    return null;
  }

  return buildGcpTerraformSnippet({
    slug: args.slug,
    region: args.region,
    components: args.estimate.components,
    commentLabel: cloudMeta[args.cloud].name
  });
}
