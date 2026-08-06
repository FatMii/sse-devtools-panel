import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-close");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/shared/stream-close.ts"),
      formats: ["es"],
      fileName: () => "stream-close",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "stream-close.js",
      },
    },
  },
  logLevel: "error",
});

const {
  classifyThrownError,
  classifyHttpStatus,
  isStreamCloseReason,
  latestEventIdFromEvents,
  normalizeReconnectMarks,
} = await import(`file:///${resolve(outDir, "stream-close.js").replace(/\\/g, "/")}`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const abortErr = classifyThrownError(
  Object.assign(new Error("The user aborted a request."), { name: "AbortError" }),
);
assert(abortErr.closeReason === "abort", "abort reason");
assert(/aborted/i.test(abortErr.message), "abort message");

const netErr = classifyThrownError(new Error("Failed to fetch"));
assert(netErr.closeReason === "error", "network reason");

const http = classifyHttpStatus(502);
assert(http.closeReason === "http_error", "http reason");
assert(http.message === "HTTP 502", "http message");

assert(isStreamCloseReason("abort"), "valid reason");
assert(!isStreamCloseReason("nope"), "invalid reason");

assert(latestEventIdFromEvents([{ id: "1" }, { id: "2" }, {}]) === "2", "latest id");
assert(latestEventIdFromEvents([{}]) === undefined, "no id");

const marks = normalizeReconnectMarks([
  { at: 10, reconnectCount: 1, lastEventId: "a" },
  { at: "bad" },
  { at: 20, reconnectCount: 2 },
]);
assert(marks?.length === 2, "reconnect marks");
assert(marks[0].lastEventId === "a", "reconnect id");
assert(marks[1].lastEventId === undefined, "reconnect id optional");

rmSync(outDir, { recursive: true, force: true });
console.log("stream-close tests passed");
