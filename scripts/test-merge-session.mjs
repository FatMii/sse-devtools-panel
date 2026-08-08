import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-merge-session");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/shared/ai-merge/index.ts"),
      formats: ["es"],
      fileName: () => "ai-merge",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "ai-merge.js",
      },
    },
  },
  logLevel: "error",
});

const { ConversationMergeSession, mergeAiConversation } = await import(
  `file:///${resolve(outDir, "ai-merge.js").replace(/\\/g, "/")}`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function chunk(content) {
  return {
    event: "message",
    data: JSON.stringify({
      id: "x",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content } }],
    }),
  };
}

const events = [chunk("Hel"), chunk("lo"), chunk("!")];
const oneShot = mergeAiConversation(events);

const session = new ConversationMergeSession();
session.push(events.slice(0, 1));
session.push(events.slice(0, 2));
session.push(events);
const incremental = session.snapshot();

assert(oneShot.channels.content === "Hello!", `oneShot content got ${oneShot.channels.content}`);
assert(
  incremental.channels.content === oneShot.channels.content,
  "incremental matches one-shot content",
);
assert(incremental.profile === oneShot.profile, "profile match");
assert(session.consumedCount === 3, "consumed all");

// Further push with no new events is a no-op
session.push(events);
assert(session.snapshot().channels.content === "Hello!", "idempotent");

rmSync(outDir, { recursive: true, force: true });
console.log("merge-session tests passed");
