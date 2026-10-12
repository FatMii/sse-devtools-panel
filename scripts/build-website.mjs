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
