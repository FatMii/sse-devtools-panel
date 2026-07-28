import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-spec");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/shared/sse-spec.ts"),
      formats: ["es"],
      fileName: () => "sse-spec",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "sse-spec.js",
      },
    },
  },
  logLevel: "error",
});

const {
  lintSseEventBlock,
  lintSseStreamRaw,
  scanStreamSpecWarnings,
  buildSseFixture,
} = await import(`file:///${resolve(outDir, "sse-spec.js").replace(/\\/g, "/")}`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

{
  const w = lintSseEventBlock("data: ok\n\n".trimEnd(), 0);
  assert(w.length === 0, "clean block");
}

{
  const w = lintSseEventBlock("foo: 1\ndata: x", 2);
  assert(w.length === 1 && w[0].kind === "unknown-field", "unknown field");
  assert(w[0].detail === "foo" && w[0].eventIndex === 2, "unknown field detail");
}

{
  const w = lintSseEventBlock("retry: 1.5\ndata: x", 0);
  assert(w.some((x) => x.kind === "invalid-retry"), "invalid retry");
}

{
  const w = lintSseEventBlock("retry: 12\ndata: x", 0);
  assert(!w.some((x) => x.kind === "invalid-retry"), "valid retry");
}

{
  const w = lintSseEventBlock("id: a\u0000b\ndata: x", 1);
  assert(w.some((x) => x.kind === "null-in-id"), "null in id");
}

{
  const w = lintSseEventBlock("\uFEFFdata: x", 0);
  assert(w.some((x) => x.kind === "bom"), "bom on block");
}

{
  const w = lintSseStreamRaw("\uFEFFdata: x\n\n");
  assert(w.length === 1 && w[0].kind === "bom", "stream bom");
}

{
  const warnings = scanStreamSpecWarnings({
    streamKind: "ndjson",
    raw: "foo: 1\ndata: x\n\n",
    events: [{ index: 0, event: "message", data: "x", raw: "foo: 1\ndata: x", receivedAt: 1 }],
  });
  assert(warnings.length === 0, "ndjson skipped");
}

{
  const warnings = scanStreamSpecWarnings({
    streamKind: "sse",
    raw: "\uFEFFdata: x\n\n",
    events: [{ index: 0, event: "message", data: "x", raw: "\uFEFFdata: x", receivedAt: 1 }],
  });
  assert(warnings.filter((x) => x.kind === "bom").length === 1, "dedupe bom");
}

{
  const text = buildSseFixture([
    { event: "message", data: '{"a":1}' },
    { event: "delta", id: "2", data: "hello\nworld", retry: 3000 },
  ]);
  assert(text.includes("data: {\"a\":1}"), "fixture data");
  assert(text.includes("event: delta"), "fixture event");
  assert(text.includes("id: 2"), "fixture id");
  assert(text.includes("retry: 3000"), "fixture retry");
  assert(text.includes("data: hello\ndata: world"), "fixture multiline");
  assert(text.endsWith("\n\n"), "fixture trailing blank");
  assert(!text.includes("event: message"), "omit default event");
}

rmSync(outDir, { recursive: true, force: true });
console.log("sse-spec tests passed");
