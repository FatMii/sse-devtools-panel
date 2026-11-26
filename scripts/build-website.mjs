#!/usr/bin/env node
/**
 * Build website with GitHub Pages base path (production defaults).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const websiteDir = path.join(root, "website");
const shotsDir = path.join(websiteDir, "public", "screenshots");

const env = {
  ...process.env,
  SITE_URL: process.env.SITE_URL ?? "https://fatmii.github.io/sse-devtools-panel",
  // Trailing slash required so `${BASE_URL}favicon.png` resolves under the Pages subpath.
  SITE_BASE: process.env.SITE_BASE ?? "/sse-devtools-panel/",
};

const requiredClips = [
  "panel-overview.webm",
  "panel-overview.mp4",
  "panel-overview-poster.jpg",
  "deepseek-conversation.webm",
  "deepseek-conversation.mp4",
  "deepseek-conversation-poster.jpg",
  "conversation-profile.webm",
  "conversation-profile.mp4",
  "conversation-profile-poster.jpg",
  "stream-anomalies.webm",
  "stream-anomalies.mp4",
  "stream-anomalies-poster.jpg",
  "virtual-scrolling.webm",
  "virtual-scrolling.mp4",
  "virtual-scrolling-poster.jpg",
];

execSync("node scripts/sync-website-screenshots.mjs", { cwd: root, stdio: "inherit" });

const missing = requiredClips.filter((f) => !fs.existsSync(path.join(shotsDir, f)));
// Always run the encoder: it no-ops when webm/mp4/poster are newer than the source GIF.
// Skipping entirely when files exist left Hero stuck on stale panel-overview clips after GIF updates.
try {
  execSync("pnpm --dir website exec node ../scripts/encode-website-media.mjs", {
    cwd: root,
    stdio: "inherit",
  });
} catch (err) {
  if (missing.length) {
    console.error(
      "[build-website] encode failed and required clips are missing:",
      missing.join(", "),
    );
    throw err;
  }
  console.warn(
    "[build-website] encode failed; continuing with committed clips:",
    err instanceof Error ? err.message : err,
  );
}

execSync("pnpm build", { cwd: websiteDir, stdio: "inherit", env });
writeSeoFiles(path.join(websiteDir, "dist"), env.SITE_URL, env.SITE_BASE);

function writeSeoFiles(distDir, siteUrl, siteBase) {
  const prefix = siteBase.startsWith("/") ? siteBase : `/${siteBase}`;
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const origin = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  const loc = (pathname) => new URL(pathname, origin).href;
  const zhHome = loc(base);
  const enHome = loc(`${base}en/`);
  const zhPrivacy = loc(`${base}privacy/`);
  const enPrivacy = loc(`${base}en/privacy/`);
  const alt = (zh, en) => `    <xhtml:link rel="alternate" hreflang="zh-CN" href="${zh}" />
    <xhtml:link rel="alternate" hreflang="en" href="${en}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${zh}" />`;
  const entry = (url, zh, en, priority) => `  <url>
    <loc>${url}</loc>
${alt(zh, en)}
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entry(zhHome, zhHome, enHome, "1.0")}
${entry(enHome, zhHome, enHome, "0.9")}
${entry(zhPrivacy, zhPrivacy, enPrivacy, "0.4")}
${entry(enPrivacy, zhPrivacy, enPrivacy, "0.3")}
</urlset>
`;
  fs.writeFileSync(path.join(distDir, "sitemap.xml"), sitemap);
  fs.writeFileSync(
    path.join(distDir, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap.xml", zhHome).href}\n`,
  );
}
