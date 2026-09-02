import { defineConfig } from "astro/config";

const siteUrl = process.env.SITE_URL ?? "https://fatmii.github.io/sse-devtools-panel";
// Dev: `/` (http://localhost:4321/). Production GitHub Pages: `/sse-devtools-panel` via SITE_BASE.
const siteBase = process.env.SITE_BASE ?? "/";

export default defineConfig({
  site: siteUrl,
  output: "static",
  base: siteBase,
  build: {
    format: "directory",
  },
  i18n: {
    defaultLocale: "zh",
    locales: ["zh", "en"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
