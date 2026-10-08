#!/usr/bin/env node
/**
 * Encode website demo GIFs to WebM/MP4 + poster (quality-preserving, much smaller).
 * Requires: website/node_modules/ffmpeg-static
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "website", "package.json"));
const ffmpeg = require("ffmpeg-static");
const sourceDir = path.join(root, "docs", "assets", "screenshots");
const targetDir = path.join(root, "website", "public", "screenshots");

const clips = ["panel-overview", "deepseek-conversation", "virtual-scrolling"];

if (!ffmpeg || !fs.existsSync(ffmpeg)) {
  console.error(
    "[encode-website-media] ffmpeg-static binary missing. Run: pnpm --filter sse-devtools-panel-website i",
  );
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

function run(args) {
  const result = spawnSync(ffmpeg, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (${result.status}): ${args.join(" ")}`);
  }
}

function kb(file) {
  return `${(fs.statSync(file).size / 1024).toFixed(0)} KB`;
}

for (const name of clips) {
  const gif = path.join(sourceDir, `${name}.gif`);
  if (!fs.existsSync(gif)) {
    console.warn(`[encode-website-media] skip missing ${name}.gif`);
    continue;
  }

  const webm = path.join(targetDir, `${name}.webm`);
  const mp4 = path.join(targetDir, `${name}.mp4`);
  const poster = path.join(targetDir, `${name}-poster.jpg`);

  const gifMtime = fs.statSync(gif).mtimeMs;
  const fresh = [webm, mp4, poster].every(
    (f) => fs.existsSync(f) && fs.statSync(f).mtimeMs >= gifMtime,
  );
  if (fresh) {
    console.log(`[encode-website-media] skip ${name} (up to date)`);
    continue;
  }

  console.log(`[encode-website-media] ${name}.gif → webm/mp4/poster`);

  // High visual quality VP9 (CRF 28 is visually near-lossless for UI demos)
  run([
    "-y",
    "-i",
    gif,
    "-c:v",
    "libvpx-vp9",
    "-b:v",
    "0",
    "-crf",
    "28",
    "-an",
    "-row-mt",
    "1",
    webm,
  ]);

  // H.264 fallback for Safari / older browsers
  run([
    "-y",
    "-i",
    gif,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "18",
    "-preset",
    "medium",
    "-movflags",
    "+faststart",
    "-an",
    mp4,
  ]);

  run(["-y", "-i", gif, "-vframes", "1", "-q:v", "2", poster]);

  console.log(`  gif ${kb(gif)} → webm ${kb(webm)}, mp4 ${kb(mp4)}, poster ${kb(poster)}`);
}

console.log("[encode-website-media] done");
