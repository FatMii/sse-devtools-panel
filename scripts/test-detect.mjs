import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-detect");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/content/inject/detect.ts"),
      formats: ["es"],
      fileName: () => "detect",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "detect.js",
      },
    },
  },
  logLevel: "error",
});

const {
  detectStreamKind,
  resolveStreamKind,
  payloadLooksLikeStreamTrue,
  urlLooksLikeStreamQuery,
  isGenericOrMissingContentType,
} = await import(`file:///${resolve(outDir, "detect.js").replace(/\\/g, "/")}`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(detectStreamKind("text/event-stream") === "sse", "sse ct");
assert(detectStreamKind("application/json") === null, "json alone not a stream");
assert(resolveStreamKind({ responseContentType: "text/event-stream" }) === "sse", "resolve ct");

assert(
  resolveStreamKind({
    responseContentType: "application/json",
    requestHeaders: { accept: "text/event-stream" },
  }) === "sse",
  "accept event-stream",
);

assert(
  resolveStreamKind({
    responseContentType: "application/json",
    requestPayloadPreview: '{"model":"x","stream":true}',
  }) === "sse",
  "body stream true + json ct",
);

assert(
  resolveStreamKind({
    responseContentType: "application/json",
    url: "https://api.example.com/v1/chat/completions?stream=true",
  }) === "sse",
  "query stream=true",
);

assert(
  resolveStreamKind({
    responseContentType: "application/json",
    requestPayloadPreview: '{"model":"x"}',
  }) === null,
  "json without stream hint stays ignored",
);

assert(payloadLooksLikeStreamTrue('{"stream": true}') === true, "payload true");
assert(payloadLooksLikeStreamTrue('{"stream":false}') === false, "payload false");
assert(urlLooksLikeStreamQuery("/x?stream=true") === true, "url true");
assert(isGenericOrMissingContentType(null) === true, "missing ct");
assert(isGenericOrMissingContentType("application/json; charset=utf-8") === true, "json generic");

assert(
  resolveStreamKind({
    responseContentType: null,
    requestHeaders: { accept: "application/connect+json" },
  }) === "connect-json",
  "connect accept",
);

rmSync(outDir, { recursive: true, force: true });
console.log("detect tests passed");
