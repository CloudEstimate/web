import { getCollection } from "astro:content";
import { cloudOrder, siteConfig } from "@/lib/site";

function urlEntry(path: string) {
  return `<url><loc>${new URL(path, siteConfig.url).toString()}</loc></url>`;
}

export async function GET() {
  const isvs = await getCollection("isvs");
  const staticRoutes = [
    "/",
    "/isvs",
    "/about",
    "/methodology",
    "/contribute",
    "/changelog",
    "/acknowledgements",
    "/terms",
    "/privacy"
  ];

  const estimateRoutes = isvs.flatMap((isv) => [
    ...cloudOrder.map((cloud) => `/sizing/${isv.data.slug}/${cloud}`),
    `/sizing/${isv.data.slug}/compare`
  ]);

  const body = [...staticRoutes, ...estimateRoutes].map(urlEntry).join("");
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
