import type { SseEvent } from "./types";

/** Wire-shape family used for transcript merge. */
export type AiProfile =
  | "openai-compatible"
  | "deepseek-web"
  | "doubao-web"
  | "kimi-web"
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
      (h.includes("aliyuncs.com") && h.includes("dashscope")),
  },
  {
    hint: "zhipu",
    test: (h) => h.includes("bigmodel.cn") || h.includes("zhipuai") || h.includes("chatglm"),
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
    if (isAnthropicChunk(parsed) || ev.event.startsWith("content_block") || ev.event === "message_delta") {
      anthropicHits++;
    }
  }

  const scores: Array<{ profile: AiProfile; score: number }> = [
    { profile: "openai-compatible", score: openaiHits },
    { profile: "deepseek-web", score: deepseekHits },
    { profile: "doubao-web", score: doubaoHits },
    { profile: "kimi-web", score: kimiHits },
    { profile: "anthropic", score: anthropicHits },
  ];
  scores.sort((a, b) => b.score - a.score);

  let profile: AiProfile = "generic";
  if (scores[0].score >= 1) profile = scores[0].profile;

  // Prefer kimi-web on moonshot/kimi hosts when Connect frames are present.
  if (vendorHint === "moonshot" && kimiHits >= 2 && kimiHits >= openaiHits) {
    profile = "kimi-web";
  }

  let resolvedVendor = vendorHint;
  if (profile === "deepseek-web") resolvedVendor = "deepseek";
  else if (profile === "doubao-web") resolvedVendor = "doubao-web";
  else if (profile === "kimi-web") resolvedVendor = "moonshot";
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
