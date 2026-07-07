import path from "node:path";
import { defineConfig } from "astro/config";
import { resolveSiteUrl } from "./src/lib/site-url.ts";

const isProductionBuild =
  process.env.CI === "true" || process.env.npm_lifecycle_event === "build" || process.argv.includes("build");
const siteUrl = resolveSiteUrl(process.env.PUBLIC_SITE_URL, !isProductionBuild);

export default defineConfig({
  site: siteUrl,
  output: "static",
  build: {
    format: "directory"
  },
  vite: {
    resolve: {
      alias: {
        "@": path.resolve("./src")
      }
    },
    test: {
      environment: "node"
    }
  }
});
