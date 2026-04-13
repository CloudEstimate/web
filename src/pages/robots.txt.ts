import { siteConfig } from "@/lib/site";

export function GET() {
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${siteConfig.url}/sitemap.xml\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
