#!/usr/bin/env node
/**
 * Copy README screenshot assets into website/public/screenshots for static hosting.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "docs", "assets", "screenshots");
const targetDir = path.join(root, "website", "public", "screenshots");

const files = [
  "panel-overview.gif",
  "tab-events.png",
  "tab-timeline.png",
  "tab-conversation-content.png",
  "main-workbench.png",
  "virtual-scrolling.gif",
  "deepseek-conversation.gif",
  "night-theme.png",
  "tab-request.png",
  "dialog-stats.png",
];

if (!fs.existsSync(sourceDir)) {
  console.warn(`[sync-website-screenshots] Source missing: ${sourceDir}`);
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });

let copied = 0;
for (const file of files) {
  const from = path.join(sourceDir, file);
  const to = path.join(targetDir, file);
  if (!fs.existsSync(from)) {
    console.warn(`[sync-website-screenshots] Skip missing: ${file}`);
    continue;
  }
  fs.copyFileSync(from, to);
  copied += 1;
}

console.log(
  `[sync-website-screenshots] Copied ${copied}/${files.length} → website/public/screenshots/`,
);
