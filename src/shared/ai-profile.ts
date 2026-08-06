import type { SseEvent } from "./types";

/** Wire-shape family used for transcript merge. */
export type AiProfile =
  | "openai-compatible"
  | "deepseek-web"
  | "doubao-web"
  | "kimi-web"
  | "qianwen-web"
  | "zhipu-web"
  | "yuanbao-web"
  | "anthropic"
  | "generic";

/** Best-effort vendor label (host / payload hints). Domestic first. */
export type AiVendorHint =
  | "deepseek"
  | "doubao-ark"
  | "doubao-web"
  | "qwen"
  | "zhipu"
  | "moonshot"
  | "yuanbao"
  | "baichuan"
  | "openai"
  | "anthropic"
  | "unknown";

export interface AiProfileResult {
  profile: AiProfile;
  vendorHint: AiVendorHint;
  /** True when at least one event looked like an AI chat stream chunk. */
  matched: boolean;
  /** Seen reasoning slot field names (e.g. reasoning_content, THINK). */
  reasoningFields: string[];
}

const VENDOR_HOST_RULES: Array<{ hint: AiVendorHint; test: (host: string) => boolean }> = [
  { hint: "deepseek", test: (h) => h.includes("deepseek.com") },
  {
    hint: "doubao-ark",
    test: (h) =>
      h.includes("volces.com") ||
      h.includes("volcengine.com") ||
      h.includes("ark.cn") ||
      h.includes("bytepluses.com"),
  },
  {
    hint: "doubao-web",
    test: (h) => h.includes("doubao.com") || h.includes("samantha") || h === "www.doubao.com",
  },
  {
    hint: "qwen",
    test: (h) =>
      h.includes("dashscope.aliyuncs.com") ||
      h.includes("tongyi") ||
      h.includes("qianwen.com") ||
      h.includes("quark.cn") ||
      (h.includes("aliyuncs.com") && h.includes("dashscope")),
  },
  {
    hint: "zhipu",
    test: (h) =>
      h.includes("bigmodel.cn") ||
      h.includes("zhipuai") ||
      h.includes("chatglm") ||
      h.includes("zhipu"),
  },
  {
    hint: "yuanbao",
    test: (h) =>
      h.includes("yuanbao.tencent.com") ||
      h.includes("yuanbao") ||
      h.includes("hunyuan.tencent.com"),
  },
  {
    hint: "moonshot",
    test: (h) =>
      h.includes("moonshot.cn") ||
      h.includes("moonshot.ai") ||
      h.includes("kimi.com") ||
      h.includes("kimi.ai") ||
      h.includes("kimi"),
  },
  { hint: "baichuan", test: (h) => h.includes("baichuan-ai.com") || h.includes("baichuan") },
  { hint: "openai", test: (h) => h.includes("openai.com") || h.includes("api.openai") },
  { hint: "anthropic", test: (h) => h.includes("anthropic.com") || h.includes("claude") },
];

const DOUBAO_WEB_EVENTS = new Set([
  "SSE_HEARTBEAT",
  "SSE_ACK",
  "FULL_MSG_NOTIFY",
  "STREAM_MSG_NOTIFY",
  "STREAM_CHUNK",
  "CHUNK_DELTA",
  "SSE_REPLY_END",
]);

const DEEPSEEK_WEB_EVENTS = new Set(["ready", "update_session", "close"]);

const KIMI_WEB_MASKS = new Set([
  "chat.lastRequest",
  "block.multiStage",
  "block.stage",
  "block.think",
  "block.text",
  "block.tool",
  "block.delta",
  "block.search",
]);

/** Masks that are too generic as SSE event names (OpenAI uses event=message). */
const KIMI_GENERIC_EVENT_NAMES = new Set(["message", "delta"]);

export function vendorHintFromUrl(url: string | undefined): AiVendorHint {
  if (!url) return "unknown";
  let host = "";
  try {
    host = new URL(url, "https://dummy.local").hostname.toLowerCase();
  } catch {
    host = url.toLowerCase();
  }
  for (const rule of VENDOR_HOST_RULES) {
    if (rule.test(host)) return rule.hint;
  }
  return "unknown";
}

function tryParseJson(data: string): unknown | null {
  const trimmed = data.trim();
  if (!trimmed || trimmed === "[DONE]") return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** OpenAI chat.completion.chunk shape (and compatible forks). */
export function isOpenAiCompatibleChunk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.choices) || value.choices.length === 0) return false;
  const choice0 = value.choices[0];
  if (!isRecord(choice0)) return false;
  return isRecord(choice0.delta) || isRecord(choice0.message);
}

/** DeepSeek chat.deepseek.com JSON-patch style chunk. */
export function isDeepseekWebChunk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.p === "string" && ("v" in value || typeof value.o === "string")) return true;
  if (typeof value.v === "string") return true;
  if (isRecord(value.v) && isRecord(value.v.response)) return true;
  if (typeof value.request_message_id === "number" && typeof value.response_message_id === "number") {
    return true;
  }
  return false;
}

/** Doubao.com web SSE payload (STREAM_* / CHUNK_DELTA / …). */
export function isDoubaoWebChunk(value: unknown, eventName?: string): boolean {
  if (eventName && DOUBAO_WEB_EVENTS.has(eventName)) return true;
  if (!isRecord(value)) return false;
  if (typeof value.text === "string" && Object.keys(value).length <= 3) return true;
  if (Array.isArray(value.patch_op)) return true;
  if (isRecord(value.content) && Array.isArray(value.content.content_block)) return true;
  if (isRecord(value.message) && typeof value.message.content_type === "number") return true;
  if (typeof value.content_type === "number" || typeof value.block_type === "number") return true;
  if (typeof value.end_type === "number") return true;
  return false;
}

const QIANWEN_WEB_MIME_TYPES = new Set([
  "plan_cot/post",
  "multi_load/iframe",
  "bar/progress",
  "bar/iframe",
  "signal/post",
  "paa/iframe",
]);

/** Qianwen / Tongyi web AgentProxy SSE (data.messages[].mime_type). */
export function isQianwenWebChunk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const data = isRecord(value.data) ? value.data : null;
  if (!data) return false;
  const extra = isRecord(data.extra_info) ? data.extra_info : null;
  if (extra && extra.agent_name === "AgentProxy") return true;
  const messages = Array.isArray(data.messages) ? data.messages : [];
  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    const mime = typeof msg.mime_type === "string" ? msg.mime_type : "";
    if (QIANWEN_WEB_MIME_TYPES.has(mime)) return true;
  }
  return false;
}

/** ChatGLM / Zhipu Qingyan web SSE (conversation_id + parts[].content[]). */
export function isZhipuWebChunk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.conversation_id !== "string") return false;
  if (!Array.isArray(value.parts)) return false;
  // OpenAI chunks also have id/status-ish fields; require Zhipu part content types.
  if (Array.isArray(value.choices)) return false;
  if (value.parts.length === 0) {
    return typeof value.assistant_id === "string" || typeof value.status === "string";
  }
  for (const part of value.parts) {
    if (!isRecord(part)) continue;
    const content = Array.isArray(part.content) ? part.content : [];
    for (const item of content) {
      if (!isRecord(item) || typeof item.type !== "string") continue;
      if (item.type === "think" || item.type === "text" || item.type === "tool_calls") return true;
    }
    if (typeof part.role === "string" && (part.role === "assistant" || part.role === "user")) {
      return true;
    }
  }
  return typeof value.assistant_id === "string";
}

/**
 * Tencent Yuanbao (元宝) / Hunyuan web SSE.
 * Frames use top-level `type`: deepSearch | text | step | searchGuid | meta | …
 */
export function isYuanbaoWebChunk(value: unknown, eventName?: string): boolean {
  if (eventName === "speech_type") return true;
  if (!isRecord(value)) return false;
  if (Array.isArray(value.choices)) return false;
  const typ = typeof value.type === "string" ? value.type : "";
  if (typ === "deepSearch" && Array.isArray(value.contents)) return true;
  if (typ === "searchGuid" && Array.isArray(value.docs)) return true;
  if (typ === "step" && (typeof value.toolCallType === "string" || typeof value.scene === "string")) {
    return true;
  }
  if (typ === "meta" && (typeof value.stopReason === "string" || typeof value.pluginID === "string")) {
    return true;
  }
  if (typ === "hint_v2_tip") return true;
  // Answer deltas: {"type":"text","msg":"…"} — require msg to avoid colliding with bare shells.
  if (typ === "text" && typeof value.msg === "string") return true;
  return false;
}

/** Kimi.com Connect+JSON chat frame (mask / op / delta / block). */
export function isKimiWebChunk(value: unknown, eventName?: string): boolean {
  // Trust Connect mask-as-event only when not colliding with SSE defaults.
  if (eventName === "heartbeat") return true;
  if (
    eventName &&
    !KIMI_GENERIC_EVENT_NAMES.has(eventName) &&
    (KIMI_WEB_MASKS.has(eventName) || eventName.startsWith("block."))
  ) {
    return true;
  }
  if (!isRecord(value)) return false;
  if (value.heartbeat != null) return true;
  // Payload `mask` is authoritative (Connect JSON body).
  if (
    typeof value.mask === "string" &&
    (value.mask === "message" ||
      value.mask === "delta" ||
      KIMI_WEB_MASKS.has(value.mask) ||
      value.mask.startsWith("block."))
  ) {
    return true;
  }
  if (
    typeof value.op === "string" &&
    (isRecord(value.chat) || isRecord(value.message) || isRecord(value.block))
  ) {
    return true;
  }
  // Top-level delta without choices[] (Bridge / Kimi stream tokens).
  if (isRecord(value.delta) && typeof value.delta.content === "string" && !Array.isArray(value.choices)) {
    return true;
  }
  if (isRecord(value.block)) {
    const b = value.block;
    if (isRecord(b.text) || isRecord(b.multiStage) || isRecord(b.stage) || isRecord(b.search)) {
      return true;
    }
  }
  return false;
}

function isAnthropicChunk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const typ = value.type;
  return (
    typ === "content_block_delta" ||
    typ === "content_block_start" ||
    typ === "message_delta" ||
    typ === "message_start" ||
    typ === "message_stop"
  );
}

function collectReasoningFields(value: unknown, into: Set<string>): void {
  if (!isRecord(value)) return;
  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      if (!isRecord(choice)) continue;
      const delta = isRecord(choice.delta) ? choice.delta : null;
      const message = isRecord(choice.message) ? choice.message : null;
      for (const bag of [delta, message]) {
        if (!bag) continue;
        if (typeof bag.reasoning_content === "string") into.add("reasoning_content");
        if (typeof bag.reasoning === "string") into.add("reasoning");
      }
    }
  }
  if (isRecord(value.v) && isRecord(value.v.response) && Array.isArray(value.v.response.fragments)) {
    for (const frag of value.v.response.fragments) {
      if (isRecord(frag) && frag.type === "THINK") into.add("THINK");
      if (isRecord(frag) && frag.type === "SEARCH") into.add("SEARCH");
    }
  }
}

/**
 * Detect AI stream profile from captured SSE/NDJSON events (+ optional URL).
 * Prefers payload / event-name shape; URL supplies vendorHint.
 */
export function detectAiProfile(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
  url?: string,
): AiProfileResult {
  const vendorHint = vendorHintFromUrl(url);
  const reasoningFields = new Set<string>();
  let openaiHits = 0;
  let deepseekHits = 0;
  let doubaoHits = 0;
  let kimiHits = 0;
  let qianwenHits = 0;
  let zhipuHits = 0;
  let yuanbaoHits = 0;
  let anthropicHits = 0;
  const sampleLimit = Math.min(events.length, 80);

  for (let i = 0; i < sampleLimit; i++) {
    const ev = events[i];
    if (DEEPSEEK_WEB_EVENTS.has(ev.event)) deepseekHits += 2;
    if (DOUBAO_WEB_EVENTS.has(ev.event)) doubaoHits += 2;
    if (
      ev.event === "heartbeat" ||
      (!KIMI_GENERIC_EVENT_NAMES.has(ev.event) &&
        (KIMI_WEB_MASKS.has(ev.event) || ev.event.startsWith("block.")))
    ) {
      kimiHits += 2;
    }
    if (ev.event === "speech_type") yuanbaoHits += 2;

    const parsed = tryParseJson(ev.data);
    if (parsed == null) continue;
    if (isOpenAiCompatibleChunk(parsed)) {
      openaiHits++;
      collectReasoningFields(parsed, reasoningFields);
    }
    if (isDeepseekWebChunk(parsed)) {
      deepseekHits++;
      collectReasoningFields(parsed, reasoningFields);
    }
    if (isDoubaoWebChunk(parsed, ev.event)) doubaoHits++;
    if (isKimiWebChunk(parsed, ev.event)) {
      kimiHits++;
      if (isRecord(parsed) && isRecord(parsed.block) && isRecord(parsed.block.multiStage)) {
        reasoningFields.add("STAGE_NAME_THINKING");
      }
    }
    if (isQianwenWebChunk(parsed)) {
      qianwenHits++;
      reasoningFields.add("plan_cot/post");
      reasoningFields.add("deep_think");
    }
    if (isZhipuWebChunk(parsed)) {
      zhipuHits++;
      reasoningFields.add("think");
    }
    if (isYuanbaoWebChunk(parsed, ev.event)) {
      yuanbaoHits++;
      reasoningFields.add("deepSearch");
    }
    if (isAnthropicChunk(parsed) || ev.event.startsWith("content_block") || ev.event === "message_delta") {
      anthropicHits++;
    }
  }

  const scores: Array<{ profile: AiProfile; score: number }> = [
    { profile: "openai-compatible", score: openaiHits },
    { profile: "deepseek-web", score: deepseekHits },
    { profile: "doubao-web", score: doubaoHits },
    { profile: "kimi-web", score: kimiHits },
    { profile: "qianwen-web", score: qianwenHits },
    { profile: "zhipu-web", score: zhipuHits },
    { profile: "yuanbao-web", score: yuanbaoHits },
    { profile: "anthropic", score: anthropicHits },
  ];
  scores.sort((a, b) => b.score - a.score);

  let profile: AiProfile = "generic";
  if (scores[0].score >= 1) profile = scores[0].profile;

  // Prefer kimi-web on moonshot/kimi hosts when Connect frames are present.
  if (vendorHint === "moonshot" && kimiHits >= 2 && kimiHits >= openaiHits) {
    profile = "kimi-web";
  }

  // Prefer qianwen-web on qwen hosts when AgentProxy frames are present.
  if (vendorHint === "qwen" && qianwenHits >= 2 && qianwenHits >= openaiHits) {
    profile = "qianwen-web";
  }

  // Prefer zhipu-web on chatglm hosts when Qingyan frames are present.
  if (vendorHint === "zhipu" && zhipuHits >= 2 && zhipuHits >= openaiHits) {
    profile = "zhipu-web";
  }

  // Prefer yuanbao-web on Yuanbao/Hunyuan hosts when deepSearch frames are present.
  if (vendorHint === "yuanbao" && yuanbaoHits >= 2 && yuanbaoHits >= openaiHits) {
    profile = "yuanbao-web";
  }

  let resolvedVendor = vendorHint;
  if (profile === "deepseek-web") resolvedVendor = "deepseek";
  else if (profile === "doubao-web") resolvedVendor = "doubao-web";
  else if (profile === "kimi-web") resolvedVendor = "moonshot";
  else if (profile === "qianwen-web") resolvedVendor = "qwen";
  else if (profile === "zhipu-web") resolvedVendor = "zhipu";
  else if (profile === "yuanbao-web") resolvedVendor = "yuanbao";
  else if (
    profile === "openai-compatible" &&
    vendorHint === "unknown" &&
    reasoningFields.has("reasoning_content")
  ) {
    resolvedVendor = "deepseek";
  }

  return {
    profile,
    vendorHint: resolvedVendor,
    matched: profile !== "generic",
    reasoningFields: Array.from(reasoningFields),
  };
}
