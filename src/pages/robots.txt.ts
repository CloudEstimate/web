import { siteConfig } from "@/lib/site";

export function GET() {
  const lines = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /share/",
    `Sitemap: ${siteConfig.url}/sitemap.xml`,
    ""
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
