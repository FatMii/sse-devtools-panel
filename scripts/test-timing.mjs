import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-timing");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/shared/stream-timing.ts"),
      formats: ["es"],
      fileName: () => "stream-timing",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "stream-timing.js",
      },
    },
  },
  logLevel: "error",
});

const {
  collectEventGaps,
  buildGapHistogram,
  buildTimelineMarks,
  timelineSpanMs,
  largestGaps,
} = await import(`file:///${resolve(outDir, "stream-timing.js").replace(/\\/g, "/")}`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const events = [
  { index: 0, event: "message", receivedAt: 1000 },
  { index: 1, event: "message", receivedAt: 1015 },
  { index: 2, event: "message", receivedAt: 1065 },
  { index: 3, event: "message", receivedAt: 2065 },
];

const gaps = collectEventGaps(events);
assert(gaps.length === 3, "gap count");
assert(gaps[0].gapMs === 15 && gaps[0].afterIndex === 1, "first gap");
assert(gaps[2].gapMs === 1000 && gaps[2].afterIndex === 3, "stall gap");

const hist = buildGapHistogram(gaps);
assert(hist.some((b) => b.label === "10–25" && b.count === 1), "bin 10-25");
assert(hist.some((b) => b.label === "50–100" && b.count === 1), "bin 50-100");
assert(hist.some((b) => b.label === "1000+" && b.count === 1), "bin 1000+");

const marks = buildTimelineMarks(events, 1000);
assert(marks.length === 4, "marks");
assert(marks[0].offsetMs === 0, "origin");
assert(marks[3].offsetMs === 1065, "last offset");
assert(marks[3].gapFromPrevMs === 1000, "mark gap");
assert(timelineSpanMs(marks) === 1065, "span");

const top = largestGaps(gaps, 2);
assert(top[0].gapMs === 1000 && top[1].gapMs === 50, "largest");

rmSync(outDir, { recursive: true, force: true });
console.log("stream-timing tests passed");
