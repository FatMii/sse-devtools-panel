import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-export");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/shared/stream-snapshot.ts"),
      formats: ["es"],
      fileName: () => "stream-snapshot",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "stream-snapshot.js",
      },
    },
  },
  logLevel: "error",
});

const { escapeCsvCell, buildStreamExportCsv } = await import(
  `file:///${resolve(outDir, "stream-snapshot.js").replace(/\\/g, "/")}`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(escapeCsvCell(null) === "", "null");
assert(escapeCsvCell("plain") === "plain", "plain");
assert(escapeCsvCell('a"b') === '"a""b"', "quote");
assert(escapeCsvCell("a,b") === '"a,b"', "comma");
assert(escapeCsvCell("a\nb") === '"a\nb"', "newline");

const record = {
  requestId: "req-1",
  url: "https://example.com/sse",
  method: "GET",
  status: 200,
  transport: "fetch",
  streamKind: "sse",
  startedAt: 1,
  streamStatus: "done",
  raw: "data: hi\n\n",
  events: [
    {
      index: 0,
      event: "message",
      data: 'hello,"world"',
      receivedAt: 1_700_000_000_000,
      raw: 'data: hello,"world"\n\n',
    },
  ],
};

const csv = buildStreamExportCsv(record);
assert(csv.startsWith("\uFEFF"), "BOM");
assert(csv.includes("RequestId,URL,Method"), "header");
assert(csv.includes('"hello,""world"""'), "escaped data");
assert(csv.includes("req-1"), "request id");

rmSync(outDir, { recursive: true, force: true });
console.log("stream-export tests passed");
