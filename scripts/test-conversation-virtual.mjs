import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-conversation-virtual");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/panel/views/conversation-virtual.ts"),
      formats: ["es"],
      fileName: () => "conversation-virtual",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "conversation-virtual.js",
      },
    },
  },
  logLevel: "error",
});

const { wrapTextToRows, computeConvVirtualWindow, estimateCols } = await import(
  `file:///${resolve(outDir, "conversation-virtual.js").replace(/\\/g, "/")}`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(wrapTextToRows("", 10).length === 0, "empty");
assert(JSON.stringify(wrapTextToRows("abc", 10)) === JSON.stringify(["abc"]), "short line");
assert(
  JSON.stringify(wrapTextToRows("abcdefghijklmnop", 8)) ===
    JSON.stringify(["abcdefgh", "ijklmnop"]),
  "soft wrap",
);
assert(JSON.stringify(wrapTextToRows("a\nb", 10)) === JSON.stringify(["a", "b"]), "hard break");
assert(JSON.stringify(wrapTextToRows("a\n", 10)) === JSON.stringify(["a", ""]), "trailing nl");

const win = computeConvVirtualWindow(0, 100, 1000, 18, 2);
assert(win.start === 0, "start");
assert(win.paddingTop === 0, "pad top");
assert(win.end > 0 && win.end < 1000, "end windowed");
assert(win.paddingBottom === (1000 - win.end) * 18, "pad bottom");

assert(estimateCols(400) >= 20, "cols");

rmSync(outDir, { recursive: true, force: true });
console.log("conversation-virtual tests passed");
