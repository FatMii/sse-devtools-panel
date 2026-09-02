#!/usr/bin/env node
/**
 * Build website with GitHub Pages base path (production defaults).
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const websiteDir = path.join(root, "website");

const env = {
  ...process.env,
  SITE_URL: process.env.SITE_URL ?? "https://fatmii.github.io/sse-devtools-panel",
  SITE_BASE: process.env.SITE_BASE ?? "/sse-devtools-panel",
};

execSync("node scripts/sync-website-screenshots.mjs", { cwd: root, stdio: "inherit" });
execSync("pnpm build", { cwd: websiteDir, stdio: "inherit", env });
