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
            content_block: [
              {
                block_type: 10040,
                block_id: "think-1",
                content: { thinking_block: { streaming_title: "正在思考" } },
              },
            ],
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
                content_block: [
                  {
                    block_type: 10000,
                    block_id: "think-text",
                    parent_id: "think-1",
                    content: {
                      text_block: {
                        text: "先想",
                        icon_url: "https://cdn.example/Deep_Think.png",
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
        "STREAM_CHUNK",
      ),
      ev(JSON.stringify({ text: "一下" }), "CHUNK_DELTA"),
      ev(
        JSON.stringify({
          patch_op: [
            {
              patch_object: 1,
              patch_value: {
                content_block: [
                  {
                    block_type: 10000,
                    block_id: "answer-1",
                    content: { text_block: { text: "你好" } },
                  },
                ],
              },
            },
          ],
        }),
        "STREAM_CHUNK",
      ),
      ev(JSON.stringify({ text: "呀！" }), "CHUNK_DELTA"),
    ],
    "https://www.doubao.com/chat",
  );
  assert(t.channels.reasoning === "先想一下", `doubao reasoning got: ${t.channels.reasoning}`);
  assert(t.channels.content === "你好呀！", `doubao merge got: ${t.channels.content}`);
}

{
  // Doubao replays the same search as scene=2 citation block with a new block_id.
  const searchPayload = {
    summary: "搜索 1 个关键词，参考 2 篇资料",
    queries: ["北京今日天气"],
    results: [
      { text_card: { title: "A", url: "https://a.example", summary: "a", index: 1 } },
      { text_card: { title: "B", url: "https://b.example", summary: "b", index: 2 } },
    ],
    scene: 1,
  };
  const t = mergeAiTranscript(
    [
      ev(
        JSON.stringify({
          content: {
            content_block: [
              {
                block_type: 10040,
                block_id: "think-1",
                content: { thinking_block: { streaming_title: "正在思考" } },
              },
            ],
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
                content_block: [
                  {
                    block_type: 10025,
                    block_id: "search-live",
                    parent_id: "think-1",
                    content: { search_query_result_block: searchPayload },
                  },
                ],
              },
            },
          ],
        }),
        "STREAM_CHUNK",
      ),
      ev(
        JSON.stringify({
          patch_op: [
            {
              patch_object: 1,
              patch_value: {
                content_block: [
                  {
                    block_type: 10025,
                    block_id: "search-replay",
                    content: {
                      search_query_result_block: { ...searchPayload, scene: 2 },
                    },
                  },
                ],
              },
            },
          ],
        }),
        "STREAM_CHUNK",
      ),
    ],
    "https://www.doubao.com/chat",
  );
  assert(t.channels.tools.length === 1, `doubao search dedupe got ${t.channels.tools.length}`);
  assert(t.channels.tools[0].id === "search-live", "keep live search id");
}

{
  assert(vendorHintFromUrl("https://www.kimi.com/chat") === "moonshot", "kimi host");
  const events = [
    ev(
      JSON.stringify({
        op: "set",
        mask: "chat.lastRequest",
        chat: { id: "c1", lastRequest: { options: { thinking: true } } },
      }),
      "chat.lastRequest",
    ),
    ev(
      JSON.stringify({
        op: "set",
        mask: "message",
        message: { id: "u1", role: "user", blocks: [{ text: { content: "天气" } }] },
      }),
      "message",
    ),
    ev(
      JSON.stringify({
        op: "set",
        mask: "block.multiStage",
        block: {
          id: "1",
          multiStage: {
            stages: [{ name: "STAGE_NAME_THINKING", status: "STAGE_STATUS_START" }],
          },
        },
      }),
      "block.multiStage",
    ),
    ev(
      JSON.stringify({
        op: "set",
        mask: "block.stage",
        block: {
          id: "2",
          parentId: "1",
          stage: { name: "STAGE_NAME_THINKING", status: "STAGE_STATUS_START" },
        },
      }),
      "block.stage",
    ),
    ev(
      JSON.stringify({
        op: "set",
        mask: "block.think",
        block: { id: "3", parentId: "2", think: { content: "用户" } },
      }),
      "block.think",
    ),
    ev(
      JSON.stringify({
        op: "append",
        mask: "block.think.content",
        block: { id: "3", parentId: "2", think: { content: "询问广州天气" } },
      }),
      "block.think.content",
    ),
    ev(
      JSON.stringify({
        op: "set",
        mask: "block.stage",
        block: {
          id: "2",
          parentId: "1",
          stage: { name: "STAGE_NAME_THINKING", status: "STAGE_STATUS_END" },
        },
      }),
      "block.stage",
    ),
    ev(
      JSON.stringify({
        op: "set",
        block: {
          id: "5",
          tool: {
            toolCallId: "web_search:7",
            name: "web_search",
            args: '{"queries": ["广州天气预报 未来三天"]}',
            status: "STATUS_RUNNING",
          },
        },
      }),
      "block.tool",
    ),
    ev(
      JSON.stringify({
        op: "set",
        mask: "block.tool.contents,block.tool.status",
        block: {
          id: "5",
          tool: {
            contents: [
              {
                searchResult: {
                  id: "1",
                  base: {
                    title: "中国天气网",
                    url: "https://www.weather.com.cn/",
                    siteName: "中国天气网",
                    snippet: "多云转晴",
                  },
                  refIndex: "web_search:7#0",
                },
              },
            ],
            status: "STATUS_DONE",
          },
        },
      }),
      "block.tool.contents,block.tool.status",
    ),
    ev(
      JSON.stringify({
        op: "append",
        mask: "block.text.content",
        block: { id: "4", parentId: "", text: { content: "正文增量" } },
      }),
      "block.text.content",
    ),
    ev(
      JSON.stringify({
        op: "set",
        mask: "message",
        message: { id: "a1", role: "assistant", status: "MESSAGE_STATUS_COMPLETED" },
      }),
      "message",
    ),
  ];
  const det = detectAiProfile(events, "https://www.kimi.com/chat/...");
  assert(det.profile === "kimi-web", `kimi profile got ${det.profile}`);
  assert(det.vendorHint === "moonshot", "kimi vendor");
  const t = mergeAiTranscript(events, "https://www.kimi.com/chat");
  assert(t.profile === "kimi-web", "kimi merge profile");
  assert(t.channels.reasoning.includes("用户"), `kimi reasoning: ${t.channels.reasoning}`);
  assert(t.channels.reasoning.includes("询问广州天气"), `kimi think.content: ${t.channels.reasoning}`);
  assert(t.channels.content.includes("正文增量"), `kimi content: ${t.channels.content}`);
  assert(!t.channels.content.includes("询问广州天气"), "thinking must not leak");
  assert(t.channels.tools.length === 1, `kimi tools ${t.channels.tools.length}`);
  assert(t.channels.tools[0].name === "web_search", "kimi web_search");
  assert(t.endMeta.finishReason === "stop", "kimi finish");
  assert(transcriptHasContent(t), "kimi has content");
}

{
  const qianwenEnvelope = (messages, extra = {}) =>
    JSON.stringify({
      error_msg: "",
      error_code: 0,
      data: {
        extra_info: { agent_name: "AgentProxy", scene: "deep_think_r1lite", ...extra },
        messages,
      },
    });

  const events = [
    ev(
      qianwenEnvelope([
        {
          mime_type: "plan_cot/post",
          content: "用户询问深圳天气，准备搜索相关信息。",
          status: "processing",
        },
      ]),
    ),
    ev(
      qianwenEnvelope([
        {
          mime_type: "plan_cot/post",
          content:
            "用户询问深圳天气，准备搜索相关信息。\n我准备通过这些步骤来收集信息。\n- 查询深圳今日天气 ",
          status: "processing",
        },
      ]),
    ),
    ev(
      qianwenEnvelope([
        {
          mime_type: "bar/progress",
          meta_data: {
            type: "cot",
            content: { list: [{ query: "深圳天气" }] },
          },
          status: "processing",
        },
      ]),
    ),
    ev(
      qianwenEnvelope([
        {
          mime_type: "bar/progress",
          meta_data: {
            match_num: 2,
            list: [
              {
                title: "深圳天气预报",
                url: "https://weather.sz.gov.cn/",
                summary: "多云间晴天",
              },
            ],
          },
          status: "processing",
        },
      ]),
    ),
    ev(
      qianwenEnvelope([
        {
          mime_type: "multi_load/iframe",
          meta_data: {
            multi_load: [
              {
                type: "deep_think",
                content: { think_content: "我需要回答深圳天气", status: "processing" },
              },
            ],
          },
          content: "[(deep_think)]",
          status: "processing",
        },
      ]),
    ),
    ev(
      qianwenEnvelope([
        {
          mime_type: "multi_load/iframe",
          meta_data: {
            multi_load: [
              {
                type: "deep_think",
                content: {
                  think_content: "我需要回答深圳天气，根据检索结果整理答案。",
                  status: "complete",
                },
              },
            ],
          },
          content: "[(deep_think)]\n\n今日深圳多云间晴天",
          status: "processing",
        },
      ]),
    ),
    ev(
      qianwenEnvelope(
        [
          {
            mime_type: "multi_load/iframe",
            meta_data: { multi_load: [] },
            content: "[(deep_think)]\n\n今日深圳多云间晴天，气温26~33℃。",
            status: "complete",
          },
        ],
        { sse_end: "1" },
      ),
    ),
  ];

  const det = detectAiProfile(events, "https://www.qianwen.com/chat");
  assert(det.profile === "qianwen-web", `qianwen profile got ${det.profile}`);
  assert(det.vendorHint === "qwen", "qianwen vendor");
  const t = mergeAiTranscript(events, "https://www.qianwen.com/chat");
  assert(t.profile === "qianwen-web", "qianwen merge profile");
  assert(t.channels.reasoning.includes("用户询问深圳天气"), `qianwen plan_cot: ${t.channels.reasoning}`);
  assert(t.channels.reasoning.includes("根据检索结果"), `qianwen deep_think: ${t.channels.reasoning}`);
  assert(t.channels.content.includes("今日深圳多云间晴天"), `qianwen content: ${t.channels.content}`);
  assert(!t.channels.content.includes("我需要回答深圳天气"), "thinking must not leak");
  assert(t.channels.tools.length === 1, `qianwen tools ${t.channels.tools.length}`);
  assert(t.channels.tools[0].name === "web_search", "qianwen web_search");
  const args = JSON.parse(t.channels.tools[0].arguments);
  assert(Array.isArray(args.queries) && args.queries.some((q) => String(q).includes("深圳")), "qianwen queries");
  assert(Array.isArray(args.results) && args.results.length >= 1, "qianwen results");
  assert(t.endMeta.finishReason === "stop", "qianwen finish");
  assert(transcriptHasContent(t), "qianwen has content");
}

{
  const qianwenEnvelope = (messages) =>
    JSON.stringify({
      error_code: 0,
      data: { extra_info: { agent_name: "AgentProxy" }, messages },
    });

  const stackedPlanCot =
    "这是一个\n" +
    "这是一个关于合肥市当日天气\n" +
    "这是一个关于合肥市当日天气情况的查询问题。需要提供合肥市今天的温度范围、天气现象、风力风向、湿度等实时天气数据，以及相关的天气预警信息和生活指数建议。\n";

  const events = [ev(qianwenEnvelope([{ mime_type: "plan_cot/post", content: stackedPlanCot }]))];
  const t = mergeAiTranscript(events, "https://www.qianwen.com/chat");
  assert(
    t.channels.reasoning ===
      "这是一个关于合肥市当日天气情况的查询问题。需要提供合肥市今天的温度范围、天气现象、风力风向、湿度等实时天气数据，以及相关的天气预警信息和生活指数建议。",
    `qianwen stacked collapse: ${JSON.stringify(t.channels.reasoning)}`,
  );
  assert(!t.channels.reasoning.includes("这是一个\n这是一个"), "stacked lines must collapse");
}

// Real captures under data/ (optional locally; skip if missing)
{
  const { readFileSync, existsSync } = await import("node:fs");
  const deepseekPath = resolve(root, "data/deepseek.txt");
  const doubaoPath = resolve(root, "data/doubao.txt");
  const kimiPath = resolve(root, "data/kimi.txt");
  const qianwenPath = resolve(root, "data/qianwen.txt");

  function loadKimiJsonStream(filePath) {
    const text = readFileSync(filePath, "utf8");
    const events = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const json = text.slice(start, i + 1);
          try {
            const parsed = JSON.parse(json);
            let eventName = "message";
            if (typeof parsed.mask === "string") {
              eventName = parsed.mask.split(",")[0].trim();
            } else if (parsed.heartbeat != null) {
              eventName = "heartbeat";
            } else if (parsed.done != null) {
              eventName = "done";
            }
            events.push({ data: json, event: eventName });
          } catch {
            // skip malformed chunk
          }
        }
      }
    }
    return events;
  }

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
      t.channels.reasoning.includes("今天是2026年8月5日") &&
        t.channels.reasoning.includes("调用搜索工具"),
      `doubao reasoning snip: ${t.channels.reasoning.slice(0, 80)}`,
    );
    assert(
      !t.channels.content.includes("调用搜索工具"),
      "thinking must not leak into content",
    );
    assert(
      t.channels.content.includes("合肥今日") && t.channels.content.includes("35℃"),
      `doubao content snip: ${t.channels.content.slice(0, 80)}`,
    );
    assert(t.channels.tools.length === 1, `doubao search tool count ${t.channels.tools.length}`);
    assert(t.channels.tools[0].name === "web_search", "doubao web_search name");
    const args = JSON.parse(t.channels.tools[0].arguments);
    assert(Array.isArray(args.queries) && args.queries.some((q) => String(q).includes("合肥")), "doubao queries");
    assert(Array.isArray(args.results) && args.results.length >= 2, "doubao results");
  }

  if (existsSync(kimiPath)) {
    const events = loadKimiJsonStream(kimiPath);
    assert(events.length > 50, `kimi events parsed: ${events.length}`);
    const t = mergeAiTranscript(events, "https://www.kimi.com/chat");
    assert(t.profile === "kimi-web", `kimi profile got ${t.profile}`);
    assert(t.vendorHint === "moonshot", "kimi vendor");
    assert(
      t.channels.reasoning.includes("未来三天") && t.channels.reasoning.includes("广州"),
      `kimi reasoning snip: ${t.channels.reasoning.slice(0, 80)}`,
    );
    assert(
      !t.channels.content.includes("我需要搜索广州"),
      "think must not leak into content",
    );
    assert(
      t.channels.content.includes("广州未来三天") || t.channels.content.includes("天气预报"),
      `kimi content snip: ${t.channels.content.slice(0, 80)}`,
    );
    assert(t.channels.tools.length >= 1, `kimi tools ${t.channels.tools.length}`);
    assert(t.channels.tools[0].name === "web_search", "kimi web_search");
    const args = JSON.parse(t.channels.tools[0].arguments);
    assert(Array.isArray(args.queries) && args.queries.some((q) => String(q).includes("广州")), "kimi queries");
    assert(Array.isArray(args.results) && args.results.length >= 1, "kimi results");
  }

  if (existsSync(qianwenPath)) {
    const events = loadSse(qianwenPath);
    assert(events.length > 50, `qianwen events parsed: ${events.length}`);
    const t = mergeAiTranscript(events, "https://www.qianwen.com/chat");
    assert(t.profile === "qianwen-web", `qianwen profile got ${t.profile}`);
    assert(t.vendorHint === "qwen", "qianwen vendor");
    assert(
      t.channels.reasoning.includes("深圳") && t.channels.reasoning.includes("天气"),
      `qianwen reasoning snip: ${t.channels.reasoning.slice(0, 80)}`,
    );
    assert(
      !t.channels.content.includes("我需要回答今天"),
      "think must not leak into content",
    );
    assert(
      t.channels.content.includes("今日深圳市") || t.channels.content.includes("多云间晴天"),
      `qianwen content snip: ${t.channels.content.slice(0, 80)}`,
    );
    assert(t.channels.tools.length >= 1, `qianwen tools ${t.channels.tools.length}`);
    assert(t.channels.tools[0].name === "web_search", "qianwen web_search");
    const args = JSON.parse(t.channels.tools[0].arguments);
    assert(Array.isArray(args.queries) && args.queries.some((q) => String(q).includes("深圳")), "qianwen queries");
    assert(Array.isArray(args.results) && args.results.length >= 1, "qianwen results");
  }
}

console.log("ai-merge tests passed");
