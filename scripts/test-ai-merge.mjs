import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, ".tmp-test-ai-merge");

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

async function buildEntry(entry, name) {
  await build({
    configFile: false,
    root,
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: resolve(root, entry),
        formats: ["es"],
        fileName: () => name,
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          entryFileNames: `${name}.js`,
        },
      },
    },
    logLevel: "error",
  });
  return import(`file:///${resolve(outDir, `${name}.js`).replace(/\\/g, "/")}`);
}

const { detectAiProfile, vendorHintFromUrl } = await buildEntry(
  "src/shared/ai-profile.ts",
  "ai-profile",
);
const { mergeAiTranscript, transcriptHasContent } = await buildEntry(
  "src/shared/ai-merge.ts",
  "ai-merge",
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ev(data, event = "message") {
  return { data, event };
}

{
  assert(vendorHintFromUrl("https://api.deepseek.com/chat/completions") === "deepseek", "deepseek host");
  assert(
    vendorHintFromUrl("https://ark.cn-beijing.volces.com/api/v3/chat/completions") === "doubao-ark",
    "doubao ark host",
  );
  assert(
    vendorHintFromUrl("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions") === "qwen",
    "qwen host",
  );
}

{
  const events = [
    ev(
      JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "deepseek-reasoner",
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      }),
    ),
    ev(
      JSON.stringify({
        choices: [{ index: 0, delta: { reasoning_content: "先想一步" }, finish_reason: null }],
      }),
    ),
    ev(
      JSON.stringify({
        choices: [{ index: 0, delta: { reasoning_content: "再想一步" }, finish_reason: null }],
      }),
    ),
    ev(
      JSON.stringify({
        choices: [{ index: 0, delta: { content: "你好" }, finish_reason: null }],
      }),
    ),
    ev(
      JSON.stringify({
        choices: [{ index: 0, delta: { content: "，世界" }, finish_reason: null }],
      }),
    ),
    ev(
      JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    ),
    ev("[DONE]"),
  ];

  const det = detectAiProfile(events, "https://api.deepseek.com/v1/chat/completions");
  assert(det.profile === "openai-compatible", "profile openai");
  assert(det.vendorHint === "deepseek", "vendor deepseek");
  assert(det.reasoningFields.includes("reasoning_content"), "reasoning field");

  const t = mergeAiTranscript(events, "https://api.deepseek.com/v1/chat/completions");
  assert(t.channels.reasoning === "先想一步再想一步", "reasoning merge");
  assert(t.channels.content === "你好，世界", "content merge");
  assert(t.endMeta.finishReason === "stop", "finish");
  assert(t.endMeta.usage && t.endMeta.usage.total_tokens === 15, "usage");
  assert(transcriptHasContent(t), "has content");
}

{
  const events = [
    ev(
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_" } }],
            },
            finish_reason: null,
          },
        ],
      }),
    ),
    ev(
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { name: "weather", arguments: '{"city":' } }],
            },
            finish_reason: null,
          },
        ],
      }),
    ),
    ev(
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '"SZ"}' } }] },
            finish_reason: "tool_calls",
          },
        ],
      }),
    ),
  ];
  const t = mergeAiTranscript(
    events,
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  );
  assert(t.profile === "openai-compatible", "tool profile");
  assert(t.vendorHint === "qwen", "qwen vendor");
  assert(t.channels.tools.length === 1, "one tool");
  assert(t.channels.tools[0].name === "get_weather", "tool name concat");
  assert(t.channels.tools[0].arguments === '{"city":"SZ"}', "tool args concat");
  assert(t.endMeta.finishReason === "tool_calls", "tool finish");
}

{
  const events = [ev("not-json"), ev("data: hello")];
  const t = mergeAiTranscript(events);
  assert(t.profile === "generic", "generic");
  assert(!transcriptHasContent(t), "empty transcript");
}

{
  const events = [
    ev(JSON.stringify({ block_type: 10000, content: { text_block: { text: "答" } } }), "STREAM_CHUNK"),
    ev(JSON.stringify({ block_type: 10040, content: { text_block: { text: "想" } } }), "STREAM_CHUNK"),
  ];
  // Without STREAM_* event names, top-level block_type still detects doubao-web via payload.
  const det = detectAiProfile(
    [
      ev(JSON.stringify({ block_type: 10000, content: { text_block: { text: "答" } } })),
      ev(JSON.stringify({ text: "x" }), "CHUNK_DELTA"),
    ],
    "https://www.doubao.com/chat",
  );
  assert(det.profile === "doubao-web", "doubao web profile");

  const t = mergeAiTranscript(
    [
      ev(
        JSON.stringify({
          content: {
            content_block: [{ block_type: 10000, content: { text_block: { text: "你" } } }],
          },
          meta: { user_type: 2 },
        }),
        "STREAM_MSG_NOTIFY",
      ),
      ev(
        JSON.stringify({
          patch_op: [
            {
              patch_object: 1,
              patch_value: {
                content_block: [{ block_type: 10000, content: { text_block: { text: "好" } } }],
              },
            },
          ],
        }),
        "STREAM_CHUNK",
      ),
      ev(JSON.stringify({ text: "呀" }), "CHUNK_DELTA"),
      ev(JSON.stringify({ text: "！" }), "CHUNK_DELTA"),
    ],
    "https://www.doubao.com/chat",
  );
  assert(t.channels.content === "你好呀！", `doubao merge got: ${t.channels.content}`);
}

// Real captures under data/ (optional locally; skip if missing)
{
  const { readFileSync, existsSync } = await import("node:fs");
  const deepseekPath = resolve(root, "data/deepseek.txt");
  const doubaoPath = resolve(root, "data/doubao.txt");

  await buildEntry("src/shared/sse-parser.ts", "sse-parser");
  const { SseParser } = await import(
    `file:///${resolve(outDir, "sse-parser.js").replace(/\\/g, "/")}`
  );

  function loadSse(filePath) {
    const text = readFileSync(filePath, "utf8");
    const parser = new SseParser();
    const events = [...parser.push(text), ...parser.flush()];
    return events.map((e) => ({ data: e.data, event: e.event }));
  }

  if (existsSync(deepseekPath)) {
    const events = loadSse(deepseekPath);
    const t = mergeAiTranscript(events, "https://chat.deepseek.com/api/v0/chat/completion");
    assert(t.profile === "deepseek-web", `deepseek profile got ${t.profile}`);
    assert(t.vendorHint === "deepseek", "deepseek vendor");
    assert(t.channels.reasoning.includes("分析用户输入"), `reasoning snip: ${t.channels.reasoning.slice(0, 40)}`);
    assert(t.channels.content.includes("啊啊"), `content snip: ${t.channels.content.slice(0, 40)}`);
    assert(t.channels.content.includes("破局三板斧") || t.channels.content.includes("三板斧"), "content axe");
    assert(t.endMeta.finishReason === "FINISHED" || t.endMeta.finishReason === "close", "deepseek finish");
  }

  const deepseekSearchPath = resolve(root, "data/deepseek-search.txt");
  if (existsSync(deepseekSearchPath)) {
    const events = loadSse(deepseekSearchPath);
    const t = mergeAiTranscript(events, "https://chat.deepseek.com/api/v0/chat/completion");
    assert(t.profile === "deepseek-web", "search profile");
    assert(t.channels.tools.length >= 1, "search tool present");
    assert(t.channels.tools[0].name === "web_search", "web_search name");
    const args = JSON.parse(t.channels.tools[0].arguments);
    assert(Array.isArray(args.queries) && args.queries.length >= 1, "search queries");
    assert(Array.isArray(args.results) && args.results.length >= 2, "search results");
    assert(t.channels.content.includes("今天首尔很热"), `search content: ${t.channels.content}`);
  }

  if (existsSync(doubaoPath)) {
    const events = loadSse(doubaoPath);
    const t = mergeAiTranscript(events, "https://www.doubao.com/chat");
    assert(t.profile === "doubao-web", `doubao profile got ${t.profile}`);
    assert(t.vendorHint === "doubao-web", "doubao vendor");
    assert(
      t.channels.content === "你好呀😊，有什么我可以帮你的吗？",
      `doubao content got: ${JSON.stringify(t.channels.content)}`,
    );
  }
}

console.log("ai-merge tests passed");
