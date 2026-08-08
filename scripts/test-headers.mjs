import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-headers");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/content/inject/headers.ts"),
      formats: ["es"],
      fileName: () => "headers",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "headers.js",
      },
    },
  },
  logLevel: "error",
});

const { isSensitiveHeaderName, redactHeaderValue, normalizeHeaders } = await import(
  `file:///${resolve(outDir, "headers.js").replace(/\\/g, "/")}`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

for (const name of [
  "Authorization",
  "Cookie",
  "Set-Cookie",
  "Proxy-Authorization",
  "x-api-key",
  "api-key",
  "X-Auth-Token",
  "x-access-token",
  "private-token",
  "X-CSRF-Token",
  "x-session-token",
  "X-Goog-Api-Key",
]) {
  assert(isSensitiveHeaderName(name), `sensitive: ${name}`);
  assert(redactHeaderValue(name, "secret") === "[REDACTED]", `redact: ${name}`);
}

for (const name of ["content-type", "accept", "x-request-id", "user-agent", "cache-control"]) {
  assert(!isSensitiveHeaderName(name), `not sensitive: ${name}`);
  assert(redactHeaderValue(name, "keep") === "keep", `keep: ${name}`);
}

const normalized = normalizeHeaders({
  Authorization: "Bearer abc",
  "X-Access-Token": "tok",
  Accept: "text/event-stream",
});
assert(normalized.authorization === "[REDACTED]", "normalize auth");
assert(normalized["x-access-token"] === "[REDACTED]", "normalize access token");
assert(normalized.accept === "text/event-stream", "normalize accept");

rmSync(outDir, { recursive: true, force: true });
console.log("headers tests passed");
