import { type CloudSlug, cloudMeta } from "@/lib/site";
import type { EstimateResult } from "@/lib/types";
import { buildCloudTerraformSnippet } from "../../shared/terraform-core.mjs";

export function buildTerraformSnippet(args: {
  slug: string;
  cloud: CloudSlug;
  region: string;
  estimate: EstimateResult;
}) {
  return buildCloudTerraformSnippet({
    cloud: args.cloud,
    slug: args.slug,
    region: args.region,
    components: args.estimate.components,
    commentLabel: cloudMeta[args.cloud].name
  });
}
