import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-conversation-text");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/panel/views/conversation-text.ts"),
      formats: ["es"],
      fileName: () => "conversation-text",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "conversation-text.js",
      },
    },
  },
  logLevel: "error",
});

const { planTextPaneUpdate } = await import(
  `file:///${resolve(outDir, "conversation-text.js").replace(/\\/g, "/")}`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(planTextPaneUpdate("hello", "hello").mode === "noop", "noop");
const append = planTextPaneUpdate("hello", "hello!");
assert(append.mode === "append" && append.suffix === "!", "append");
assert(planTextPaneUpdate("", "hello").mode === "replace", "replace from empty");
assert(planTextPaneUpdate("abc", "axc").mode === "replace", "replace diverge");

rmSync(outDir, { recursive: true, force: true });
console.log("conversation-text tests passed");
