import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-ai-merge");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "src/shared/ai-merge.ts"),
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

const { buildMergedTranscript } = await import(
  `file:///${resolve(outDir, "ai-merge.js").replace(/\\/g, "/")}`
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ev(data, event = "message", index = 0) {
  return {
    index,
    event,
    data,
    raw: `data: ${data}\n\n`,
    receivedAt: Date.now(),
  };
}

const openai = buildMergedTranscript(
  [
    ev('{"choices":[{"delta":{"content":"Hello"}}]}'),
    ev('{"choices":[{"delta":{"content":" world"}}]}'),
    ev("[DONE]"),
  ],
  "openai-compatible",
);
assert(openai === "Hello world", `openai got: ${openai}`);

const anthropic = buildMergedTranscript(
  [
    ev('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}'),
    ev('{"type":"content_block_delta","delta":{"type":"text_delta","text":"!"}}'),
  ],
  "anthropic",
);
assert(anthropic === "Hi!", `anthropic got: ${anthropic}`);

const deepseek = buildMergedTranscript(
  [
    ev('{"message":{"role":"ASSISTANT","content":"首"}}', "update_session", 0),
    ev('{"v":"条"}', "message", 1),
    ev('{"v":"回复"}', "message", 2),
  ],
  "deepseek",
);
assert(deepseek === "首条回复", `deepseek got: ${deepseek}`);

const doubaoOpenAi = buildMergedTranscript(
  [
    ev('{"choices":[{"delta":{"content":"豆"}}]}'),
    ev('{"choices":[{"delta":{"content":"包"}}]}'),
  ],
  "doubao",
);
assert(doubaoOpenAi === "豆包", `doubao openai-style got: ${doubaoOpenAi}`);

const doubaoNative = buildMergedTranscript(
  [
    ev('{"content_type":10000,"content":"你好"}'),
    ev('{"block_type":10000,"content":{"text":"世界"}}'),
  ],
  "doubao",
);
assert(doubaoNative === "你好世界", `doubao native got: ${doubaoNative}`);

rmSync(outDir, { recursive: true, force: true });
console.log("ai-merge tests passed");
