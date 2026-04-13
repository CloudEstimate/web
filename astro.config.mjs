import path from "node:path";
import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "http://localhost:4321",
  output: "static",
  integrations: [tailwind()],
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
