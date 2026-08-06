import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-request-view");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/shared/request-view.ts"),
      formats: ["es"],
      fileName: () => "request-view",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "request-view.js",
      },
    },
  },
  logLevel: "error",
});

const { parseQueryStringParams, parseUrlEncodedPairs, looksLikeUrlEncoded } = await import(
  `file:///${resolve(outDir, "request-view.js").replace(/\\/g, "/")}`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const q = parseQueryStringParams("https://example.com/chat?model=gpt&n=1&model=alt");
assert(q.length === 3, "query count");
assert(q[0].name === "model" && q[0].value === "gpt", "first query");

const form = parseUrlEncodedPairs("a=1&b=hello%20world&empty=");
assert(form[0].value === "1", "form a");
assert(form[1].value === "hello world", "form decode");
assert(form[2].name === "empty" && form[2].value === "", "empty value");

assert(looksLikeUrlEncoded("a=1&b=2"), "urlencoded yes");
assert(!looksLikeUrlEncoded('{"a":1}'), "json no");

rmSync(outDir, { recursive: true, force: true });
console.log("request-view tests passed");
