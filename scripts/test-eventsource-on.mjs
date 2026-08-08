import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-eventsource-on");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/content/inject/patch-eventsource.ts"),
      formats: ["es"],
      fileName: () => "patch-eventsource",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "patch-eventsource.js",
      },
    },
  },
  logLevel: "error",
});

const { eventTypeFromOnProperty, toSseFrame } = await import(
  `file:///${resolve(outDir, "patch-eventsource.js").replace(/\\/g, "/")}`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(eventTypeFromOnProperty("onping") === "ping", "onping");
assert(eventTypeFromOnProperty("onmessage") === "message", "onmessage");
assert(eventTypeFromOnProperty("on") === null, "too short");
assert(eventTypeFromOnProperty("message") === null, "not on*");
assert(toSseFrame("ping", "hi").includes("event: ping\n"), "frame event");
assert(toSseFrame("message", "hi").startsWith("data:"), "default message");

rmSync(outDir, { recursive: true, force: true });
console.log("eventsource-on tests passed");
