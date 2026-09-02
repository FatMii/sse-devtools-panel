#!/usr/bin/env node
/**
 * Package extension dist/ into website/public/releases/*.zip for offline install.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const releasesDir = path.join(root, "website", "public", "releases");
const stagingDir = path.join(root, ".release-staging");

const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const version = manifest.version;
const zipName = `sse-devtools-panel-v${version}.zip`;
const zipPath = path.join(releasesDir, zipName);
const stagedDist = path.join(stagingDir, "dist");

function run(cmd, options = {}) {
  execSync(cmd, { stdio: "inherit", ...options });
}

if (!existsSync(distDir)) {
  console.error("[release:zip] dist/ not found. Run `pnpm build` first.");
  process.exit(1);
}

if (!existsSync(path.join(distDir, "manifest.json"))) {
  console.error("[release:zip] dist/manifest.json missing. Extension build looks incomplete.");
  process.exit(1);
}

mkdirSync(releasesDir, { recursive: true });
rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagedDist, { recursive: true });

cpSync(distDir, stagedDist, { recursive: true });

rmSync(zipPath, { force: true });

if (process.platform === "win32") {
  run(
    `powershell -NoProfile -Command "Compress-Archive -Path '${stagedDist.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
    { cwd: root },
  );
} else {
  run(`zip -r "${zipPath}" dist`, { cwd: stagingDir });
}

rmSync(stagingDir, { recursive: true, force: true });

const sizeKb = Math.round(readFileSync(zipPath).length / 1024);
console.log(`[release:zip] Wrote ${zipPath} (${sizeKb} KB)`);
