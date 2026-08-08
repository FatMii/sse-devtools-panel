import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-event-stamp");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/shared/event-stamp.ts"),
      formats: ["es"],
      fileName: () => "event-stamp",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "event-stamp.js",
      },
    },
  },
  logLevel: "error",
});

const { stampReceivedAt } = await import(
  `file:///${resolve(outDir, "event-stamp.js").replace(/\\/g, "/")}`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const base = [
  { event: "message", data: "a", raw: "a", index: 0 },
  { event: "message", data: "b", raw: "b", index: 1 },
  { event: "message", data: "c", raw: "c", index: 2 },
];

const sameChunk = stampReceivedAt(base, { now: 1000 });
assert(sameChunk[0].receivedAt === 1000, "first");
assert(sameChunk[1].receivedAt === 1001, "second spaced");
assert(sameChunk[2].receivedAt === 1002, "third spaced");

const continued = stampReceivedAt(base.slice(0, 1), {
  now: 1000,
  previousReceivedAt: 5000,
});
assert(continued[0].receivedAt === 5001, "monotonic vs previous");

assert(stampReceivedAt([], { now: 1 }).length === 0, "empty");

rmSync(outDir, { recursive: true, force: true });
console.log("event-stamp tests passed");
