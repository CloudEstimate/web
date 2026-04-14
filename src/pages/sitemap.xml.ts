import { statSync } from "node:fs";
import { join } from "node:path";
import { getCollection } from "astro:content";
import { cloudOrder, siteConfig } from "@/lib/site";
import { getPricingSnapshotDate } from "@/lib/estimates";

function sourceLastModified(sourcePath: string) {
  try {
    return statSync(join(process.cwd(), sourcePath)).mtime.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function urlEntry(path: string, lastmod?: string | null) {
  const lastmodTag = lastmod ? `<lastmod>${lastmod}</lastmod>` : "";
  return `<url><loc>${new URL(path, siteConfig.url).toString()}</loc>${lastmodTag}</url>`;
}

export async function GET() {
  const isvs = await getCollection("isvs");
  const staticRoutes = [
    { path: "/", source: "src/pages/index.astro" },
    { path: "/isvs", source: "src/pages/isvs/index.astro" },
    { path: "/about", source: "src/pages/about.astro" },
    { path: "/methodology", source: "src/pages/methodology.astro" },
    { path: "/contribute", source: "src/pages/contribute.astro" },
    { path: "/changelog", source: "src/pages/changelog.astro" },
    { path: "/acknowledgements", source: "src/pages/acknowledgements.astro" },
    { path: "/terms", source: "src/pages/terms.astro" },
    { path: "/privacy", source: "src/pages/privacy.astro" }
  ];

  const estimateRoutes = isvs.flatMap((isv) => {
    const compareLastmod = [isv.data.ref_arch.retrieved_date, ...cloudOrder.map((cloud) => getPricingSnapshotDate(cloud))]
      .sort()
      .at(-1);

    return [
      ...cloudOrder.map((cloud) => ({
        path: `/sizing/${isv.data.slug}/${cloud}`,
        lastmod: [isv.data.ref_arch.retrieved_date, getPricingSnapshotDate(cloud)].sort().at(-1)
      })),
      {
        path: `/sizing/${isv.data.slug}/compare`,
        lastmod: compareLastmod
      }
    ];
  });

  const body = [
    ...staticRoutes.map((route) => urlEntry(route.path, sourceLastModified(route.source))),
    ...estimateRoutes.map((route) => urlEntry(route.path, route.lastmod))
  ].join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8"
    }
  });
}
