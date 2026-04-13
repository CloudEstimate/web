import schema from "@/schemas/isv.schema.json?raw";
import { siteConfig } from "@/lib/site";

export async function GET() {
  const publishedSchema = schema.replace("https://example.com/schemas/isv.json", `${siteConfig.url}/schemas/isv.json`);

  return new Response(publishedSchema, {
    headers: {
      "Content-Type": "application/schema+json; charset=utf-8"
    }
  });
}
