import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-relay-buffer");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/shared/relay-buffer.ts"),
      formats: ["es"],
      fileName: () => "relay-buffer",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "relay-buffer.js",
      },
    },
  },
  logLevel: "error",
});

const { RelayBuffer, estimateRelayBytes } = await import(
  `file:///${resolve(outDir, "relay-buffer.js").replace(/\\/g, "/")}`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const buf = new RelayBuffer({ maxMessages: 3, maxBytes: 1000 });
buf.push({ type: "a", byteSize: 10 });
buf.push({ type: "b", byteSize: 10 });
buf.push({ type: "c", byteSize: 10 });
assert(buf.size === 3, "full");
buf.push({ type: "d", byteSize: 10 });
assert(buf.size === 3, "ring by count");
assert(buf.stats.truncated === true, "truncated flag");
assert(buf.stats.dropped === 1, "dropped once");
const drained = buf.drain();
assert(drained.map((x) => x.type).join("") === "bcd", "oldest dropped");
assert(buf.size === 0, "empty after drain");

const bytesBuf = new RelayBuffer({ maxMessages: 100, maxBytes: 50 });
bytesBuf.push({ type: "x", byteSize: 40 });
bytesBuf.push({ type: "y", byteSize: 40 });
assert(bytesBuf.size === 1, "ring by bytes");
assert(bytesBuf.byteSize === 40, "bytes after trim");
assert(bytesBuf.drain()[0].type === "y", "kept newest under byte cap");

assert(estimateRelayBytes({ type: "stream-chunk", payload: { text: "hi" } }) === 66, "chunk size");
assert(estimateRelayBytes({ type: "stream-end" }) === 64, "minimal");

rmSync(outDir, { recursive: true, force: true });
console.log("test-relay-buffer: ok");
