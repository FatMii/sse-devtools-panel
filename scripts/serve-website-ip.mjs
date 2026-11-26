#!/usr/bin/env node
/**
 * Serve website/dist on a high port for IP preview.
 * Build first with `pnpm website:build:cn`.
 * Do not bind 80/443 before the ICP filing is approved.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "website", "dist");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".zip": "application/zip",
  ".woff2": "font/woff2",
};

if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("[serve-website-ip] website/dist is missing. Run: pnpm website:build:cn");
  process.exit(1);
}

/**
 * @param {string} urlPath
 * @returns {string | null}
 */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = decoded.replace(/^\/+/, "");
  const full = path.normalize(path.join(distDir, rel));
  if (full !== distDir && !full.startsWith(distDir + path.sep)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url || "/";
  const filePath = resolveFile(urlPath);
  if (!filePath) {
    res.writeHead(400);
    res.end("Bad path");
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  if (stat.isDirectory()) {
    const pathname = urlPath.split("?")[0];
    if (!pathname.endsWith("/")) {
      res.writeHead(308, {
        Location: `${pathname}/${urlPath.includes("?") ? `?${urlPath.split("?")[1]}` : ""}`,
      });
      res.end();
      return;
    }
    const indexPath = path.join(filePath, "index.html");
    if (!fs.existsSync(indexPath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    send(res, indexPath);
    return;
  }

  send(res, filePath);
});

/**
 * @param {http.ServerResponse} res
 * @param {string} filePath
 */
function send(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const cache = ext === ".html" ? "no-cache" : "public, max-age=3600";
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": cache,
  });
  fs.createReadStream(filePath).pipe(res);
}

server.listen(port, host, () => {
  console.log(`[serve-website-ip] http://127.0.0.1:${port}/`);
  console.log(`[serve-website-ip] listening on ${host}:${port}`);
  console.log("[serve-website-ip] canonical in this build is https://sse.fatmii.com");
  console.log(
    "[serve-website-ip] open the security group for this port; leave 80 and 443 closed until ICP approval",
  );
});
