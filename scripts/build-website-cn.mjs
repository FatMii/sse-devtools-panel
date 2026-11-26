#!/usr/bin/env node
/**
 * Mainland site build: canonical https://sse.fatmii.com at the domain root.
 * Does not point DNS. Serve the result with scripts/serve-website-ip.mjs.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, ["scripts/build-website.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    SITE_URL: "https://sse.fatmii.com",
    SITE_BASE: "/",
  },
});

process.exit(result.status ?? 1);
