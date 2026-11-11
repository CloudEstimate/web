import { getCollection } from "astro:content";
import { buildCanonical } from "@/lib/seo";
import { categoryLabels, precomputedAI, siteConfig } from "@/lib/site";

export async function GET() {
  const isvs = (await getCollection("isvs")).sort((left, right) =>
    left.data.name.localeCompare(right.data.name)
  );

  const lines = [
    `# ${siteConfig.name}`,
    "",
    `> Reference-architecture-based infrastructure sizing and monthly cloud cost estimates for ${isvs.length} self-managed enterprise and open-source workloads across Google Cloud, AWS, and Azure.`,
    "",
    `CloudEstimate is a worked example of the ${precomputedAI.name} design pattern (${precomputedAI.url}): vendor reference architectures, shape mappings, daily cloud pricing snapshots across 12 global regions, Arm64 cost alternatives, multi-cloud Terraform/OpenTofu baselines, and validated explanations are compiled into static versioned artifacts at build time.`,
    "",
    "## Machine-Readable Static Artifacts",
    "",
    `- [Workload Catalog JSON](${buildCanonical("/api/v1/catalog.json")}): Summary index of all ${isvs.length} workloads, supported architectures, regions, and default monthly cost baselines.`,
    `- [Methodology](${buildCanonical("/methodology")}): What is modelled (compute, block/object storage, commitments, HA, Arm64 alternatives) and what is excluded (licensing, egress, backups).`,
    `- [Supported ISV Directory](${buildCanonical("/isvs")}): HTML matrix of Google Cloud, AWS, Azure, and side-by-side compare routes.`,
    "",
    "## Supported Workloads",
    "",
    ...isvs.map((isv) => {
      const category = categoryLabels[isv.data.category] ?? isv.data.category;
      const compareUrl = buildCanonical(`/sizing/${isv.data.slug}/compare`);
      const apiUrl = buildCanonical(`/api/v1/estimates/${isv.data.slug}.json`);
      return `- [${isv.data.name}](${compareUrl}) (${category} · [JSON](${apiUrl})): ${isv.data.description.trim()}`;
    }),
    ""
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

