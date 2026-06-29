import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const site = process.env.PUBLIC_SITE_URL ?? "https://your-tool.pages.dev";

export default defineConfig({
  site,
  output: "static",
  integrations: [sitemap()]
});
