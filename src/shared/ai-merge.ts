import type { SseEvent } from "./types";
import {
  detectAiProfile,
  isOpenAiCompatibleChunk,
  type AiProfile,
  type AiProfileResult,
  type AiVendorHint,
} from "./ai-profile";

export interface AiToolCall {
  index: number;
  id?: string;
  name?: string;
  arguments: string;
}

export interface AiTranscriptChannels {
  content: string;
  reasoning: string;
  tools: AiToolCall[];
}

export interface AiEndMeta {
  finishReason?: string;
  usage?: Record<string, unknown>;
  model?: string;
}

export interface AiTranscript {
  profile: AiProfile;
  vendorHint: AiVendorHint;
  detection: AiProfileResult;
  channels: AiTranscriptChannels;
  endMeta: AiEndMeta;
  /** Number of events that contributed a parseable AI chunk. */
  chunkCount: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function parseEventData(data: string): unknown | null {
  const trimmed = data.trim();
  if (!trimmed || trimmed === "[DONE]") return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function mergeOpenAiCompatible(
  events: ReadonlyArray<Pick<SseEvent, "data">>,
): { channels: AiTranscriptChannels; endMeta: AiEndMeta; chunkCount: number } {
  let content = "";
  let reasoning = "";
  const tools = new Map<number, AiToolCall>();
  const endMeta: AiEndMeta = {};
  let chunkCount = 0;

  for (const ev of events) {
    const parsed = parseEventData(ev.data);
    if (parsed == null || !isOpenAiCompatibleChunk(parsed)) continue;
    chunkCount++;
    if (!isRecord(parsed)) continue;

    if (typeof parsed.model === "string" && !endMeta.model) {
      endMeta.model = parsed.model;
    }
    if (isRecord(parsed.usage)) {
      endMeta.usage = parsed.usage as Record<string, unknown>;
    }

    const choices = parsed.choices as unknown[];
    for (const choice of choices) {
      if (!isRecord(choice)) continue;
      const finish = asString(choice.finish_reason);
      if (finish) endMeta.finishReason = finish;

      const bag = isRecord(choice.delta)
        ? choice.delta
        : isRecord(choice.message)
          ? choice.message
          : null;
      if (!bag) continue;

      const c = asString(bag.content);
      if (c) content += c;

      const rc = asString(bag.reasoning_content) ?? asString(bag.reasoning);
      if (rc) reasoning += rc;

      const toolCalls = bag.tool_calls;
      if (!Array.isArray(toolCalls)) continue;
      for (const tc of toolCalls) {
        if (!isRecord(tc)) continue;
        const index = typeof tc.index === "number" ? tc.index : 0;
        let slot = tools.get(index);
        if (!slot) {
          slot = { index, arguments: "" };
          tools.set(index, slot);
        }
        if (typeof tc.id === "string") slot.id = tc.id;
        const fn = isRecord(tc.function) ? tc.function : null;
        if (fn) {
          if (typeof fn.name === "string") {
            slot.name = (slot.name ?? "") + fn.name;
          }
          if (typeof fn.arguments === "string") {
            slot.arguments += fn.arguments;
          }
        }
      }
    }
  }

  return {
    channels: {
      content,
      reasoning,
      tools: Array.from(tools.values()).sort((a, b) => a.index - b.index),
    },
    endMeta,
    chunkCount,
  };
}

type FragType = "THINK" | "RESPONSE" | "SEARCH" | "TIP" | "OTHER";

function fragmentType(raw: unknown): FragType {
  if (!isRecord(raw) || typeof raw.type !== "string") return "OTHER";
  if (raw.type === "THINK") return "THINK";
  if (raw.type === "RESPONSE") return "RESPONSE";
  if (raw.type === "SEARCH") return "SEARCH";
  if (raw.type === "TIP") return "TIP";
  return "OTHER";
}

function appendByFragType(
  typ: FragType,
  text: string,
  channels: { content: string; reasoning: string },
): void {
  if (!text) return;
  if (typ === "THINK") channels.reasoning += text;
  else if (typ === "RESPONSE") channels.content += text;
}

function ingestSearchFragment(frag: Record<string, unknown>, tools: AiToolCall[]): void {
  const queries = Array.isArray(frag.queries) ? frag.queries : [];
  const results = Array.isArray(frag.results) ? frag.results : [];
  const queryTexts = queries
    .map((q) => (isRecord(q) && typeof q.query === "string" ? q.query : null))
    .filter((q): q is string => Boolean(q));
  const payload = {
    type: "SEARCH",
    status: frag.status ?? null,
    queries: queryTexts,
    results: results.map((r) => {
      if (!isRecord(r)) return r;
      return {
        cite_index: r.cite_index,
        title: r.title,
        url: r.url,
        site_name: r.site_name,
        snippet: r.snippet,
      };
    }),
  };
  // Update last SEARCH tool if still collecting results; else push new.
  const last = tools.length > 0 ? tools[tools.length - 1] : null;
  if (last && last.name === "web_search") {
    try {
      const prev = JSON.parse(last.arguments) as { results?: unknown[] };
      if (!Array.isArray(prev.results) || prev.results.length === 0 || results.length > 0) {
        last.arguments = JSON.stringify(payload, null, 2);
        return;
      }
    } catch {
      // fall through
    }
  }
  tools.push({
    index: tools.length,
    id: typeof frag.id === "number" || typeof frag.id === "string" ? String(frag.id) : undefined,
    name: "web_search",
    arguments: JSON.stringify(payload, null, 2),
  });
}

function ingestFragment(
  frag: unknown,
  state: { current: FragType; channels: AiTranscriptChannels; chunkCount: number },
): void {
  if (!isRecord(frag)) return;
  const typ = fragmentType(frag);
  if (typ === "SEARCH") {
    ingestSearchFragment(frag, state.channels.tools);
    state.chunkCount++;
    return;
  }
  if (typ === "TIP") {
    // Disclaimer tip — keep in meta via finish note only if needed; skip content.
    return;
  }
  if (typ === "THINK" || typ === "RESPONSE") {
    state.current = typ;
  }
  if (typeof frag.content === "string" && frag.content) {
    appendByFragType(typ === "OTHER" ? state.current : typ, frag.content, state.channels);
    state.chunkCount++;
  }
}

function applyDeepseekPatch(
  path: string,
  op: string,
  value: unknown,
  state: {
    current: FragType;
    channels: AiTranscriptChannels;
    endMeta: AiEndMeta;
    chunkCount: number;
  },
): void {
  // Nested batch paths are relative to response/
  const fullPath = path.startsWith("response/") || path === "response" ? path : `response/${path}`;

  if (fullPath === "response/fragments" && (op === "APPEND" || Array.isArray(value))) {
    const frags = Array.isArray(value) ? value : [value];
    for (const frag of frags) ingestFragment(frag, state);
    return;
  }

  if (fullPath.endsWith("/results") && Array.isArray(value)) {
    state.chunkCount++;
    const lastSearch = [...state.channels.tools].reverse().find((t) => t.name === "web_search");
    if (lastSearch) {
      try {
        const prev = JSON.parse(lastSearch.arguments) as Record<string, unknown>;
        prev.results = value.map((r) => {
          if (!isRecord(r)) return r;
          return {
            cite_index: r.cite_index,
            title: r.title,
            url: r.url,
            site_name: r.site_name,
            snippet: r.snippet,
          };
        });
        prev.status = "FINISHED";
        lastSearch.arguments = JSON.stringify(prev, null, 2);
      } catch {
        ingestSearchFragment({ type: "SEARCH", results: value, queries: [] }, state.channels.tools);
      }
    } else {
      ingestSearchFragment({ type: "SEARCH", results: value, queries: [] }, state.channels.tools);
    }
    return;
  }

  if (fullPath.includes("/content") && typeof value === "string") {
    state.chunkCount++;
    appendByFragType(state.current === "OTHER" ? "RESPONSE" : state.current, value, state.channels);
    return;
  }

  if (fullPath === "response/status" && typeof value === "string") {
    state.endMeta.finishReason = value;
    return;
  }

  if (fullPath === "response/conversation_mode" && typeof value === "string") {
    state.endMeta.model = state.endMeta.model ?? `mode:${value}`;
  }
}

/**
 * DeepSeek web (chat.deepseek.com): JSON Patch style.
 * - THINK / RESPONSE text fragments
 * - SEARCH fragment → Tools as web_search (queries + results)
 * - Shorthand { v: "token" } appends to current fragment
 */
function mergeDeepseekWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): { channels: AiTranscriptChannels; endMeta: AiEndMeta; chunkCount: number } {
  const state = {
    current: "OTHER" as FragType,
    channels: { content: "", reasoning: "", tools: [] as AiToolCall[] },
    endMeta: {} as AiEndMeta,
    chunkCount: 0,
  };

  for (const ev of events) {
    if (ev.event === "ready" || ev.event === "update_session" || ev.event === "close") {
      if (ev.event === "close") state.endMeta.finishReason = state.endMeta.finishReason ?? "close";
      continue;
    }
    const parsed = parseEventData(ev.data);
    if (!isRecord(parsed)) continue;

    // Full snapshot: { v: { response: { fragments: [...] } } }
    if (isRecord(parsed.v) && isRecord(parsed.v.response)) {
      state.chunkCount++;
      const response = parsed.v.response;
      if (Array.isArray(response.fragments)) {
        for (const frag of response.fragments) ingestFragment(frag, state);
      }
      if (response.search_triggered === true && state.channels.tools.length === 0) {
        // Flag only — SEARCH fragment may arrive in same snapshot (already handled).
      }
      if (typeof response.accumulated_token_usage === "number") {
        state.endMeta.usage = {
          ...(state.endMeta.usage ?? {}),
          accumulated_token_usage: response.accumulated_token_usage,
        };
      }
      if (typeof response.conversation_mode === "string") {
        state.endMeta.model = state.endMeta.model ?? `mode:${response.conversation_mode}`;
      }
      continue;
    }

    const path = typeof parsed.p === "string" ? parsed.p : "";
    const op = typeof parsed.o === "string" ? parsed.o : "";

    if (path === "response" && op === "BATCH" && Array.isArray(parsed.v)) {
      for (const item of parsed.v) {
        if (!isRecord(item)) continue;
        const ip = typeof item.p === "string" ? item.p : "";
        const io = typeof item.o === "string" ? item.o : "";
        if (ip === "accumulated_token_usage" && typeof item.v === "number") {
          state.endMeta.usage = {
            ...(state.endMeta.usage ?? {}),
            accumulated_token_usage: item.v,
          };
          continue;
        }
        if (ip === "quasi_status" && typeof item.v === "string") {
          state.endMeta.finishReason = item.v;
          continue;
        }
        applyDeepseekPatch(ip, io, item.v, state);
      }
      continue;
    }

    if (path) {
      applyDeepseekPatch(path, op, parsed.v, state);
      continue;
    }

    // Shorthand token: { "v": "字" }
    if (typeof parsed.v === "string") {
      state.chunkCount++;
      appendByFragType(
        state.current === "OTHER" ? "RESPONSE" : state.current,
        parsed.v,
        state.channels,
      );
    }
  }

  return {
    channels: state.channels,
    endMeta: state.endMeta,
    chunkCount: state.chunkCount,
  };
}

function extractTextBlocks(
  blocks: unknown,
  onText: (text: string, blockType?: number) => void,
): void {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    const blockType = typeof block.block_type === "number" ? block.block_type : undefined;
    const content = isRecord(block.content) ? block.content : null;
    const textBlock = content && isRecord(content.text_block) ? content.text_block : null;
    const text = textBlock ? asString(textBlock.text) : undefined;
    if (text) onText(text, blockType);
  }
}

/**
 * Doubao.com web SSE (real capture):
 * - STREAM_MSG_NOTIFY / STREAM_CHUNK content_block text_block
 * - CHUNK_DELTA { text }
 * - Ignore tts_content (duplicates text) and user FULL_MSG_NOTIFY
 */
function mergeDoubaoWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): { channels: AiTranscriptChannels; endMeta: AiEndMeta; chunkCount: number } {
  let content = "";
  let reasoning = "";
  let chunkCount = 0;
  const endMeta: AiEndMeta = {};

  const pushText = (text: string, blockType?: number) => {
    if (!text) return;
    chunkCount++;
    if (blockType === 10040) reasoning += text;
    else content += text;
  };

  for (const ev of events) {
    const name = ev.event;
    const parsed = parseEventData(ev.data);
    if (!isRecord(parsed)) continue;

    if (name === "CHUNK_DELTA") {
      const text = asString(parsed.text);
      if (text) pushText(text);
      continue;
    }

    if (name === "STREAM_MSG_NOTIFY") {
      // Assistant stream start; user_type 2 in meta
      const meta = isRecord(parsed.meta) ? parsed.meta : null;
      if (meta && meta.user_type === 1) continue;
      const bag = isRecord(parsed.content) ? parsed.content : parsed;
      if (isRecord(bag) && Array.isArray(bag.content_block)) {
        extractTextBlocks(bag.content_block, pushText);
      }
      continue;
    }

    if (name === "STREAM_CHUNK") {
      const ops = Array.isArray(parsed.patch_op) ? parsed.patch_op : [];
      for (const op of ops) {
        if (!isRecord(op)) continue;
        // patch_object 111 = tts_content — skip to avoid duplicating CHUNK_DELTA
        if (op.patch_object === 111) continue;
        const pv = isRecord(op.patch_value) ? op.patch_value : null;
        if (!pv) continue;
        if (Array.isArray(pv.content_block)) {
          extractTextBlocks(pv.content_block, pushText);
        }
      }
      continue;
    }

    if (name === "SSE_REPLY_END") {
      if (typeof parsed.end_type === "number" && parsed.end_type === 1) {
        endMeta.finishReason = "SSE_REPLY_END";
        const attr = isRecord(parsed.msg_finish_attr) ? parsed.msg_finish_attr : null;
        if (attr && typeof attr.brief === "string" && !content) {
          // Fallback if deltas were missed
          content = attr.brief;
          chunkCount++;
        }
      }
      continue;
    }

    // Fallback for captures without event names
    if (typeof parsed.text === "string") {
      pushText(parsed.text);
    } else if (typeof parsed.block_type === "number") {
      extractTextBlocks([parsed], pushText);
    }
  }

  return {
    channels: { content, reasoning, tools: [] },
    endMeta,
    chunkCount,
  };
}

/**
 * Merge stream events into a readable AI transcript.
 */
export function mergeAiTranscript(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
  url?: string,
): AiTranscript {
  const detection = detectAiProfile(events, url);
  let channels: AiTranscriptChannels = { content: "", reasoning: "", tools: [] };
  let endMeta: AiEndMeta = {};
  let chunkCount = 0;

  if (detection.profile === "openai-compatible") {
    const merged = mergeOpenAiCompatible(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  } else if (detection.profile === "deepseek-web") {
    const merged = mergeDeepseekWeb(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  } else if (detection.profile === "doubao-web") {
    const merged = mergeDoubaoWeb(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  }

  return {
    profile: detection.profile,
    vendorHint: detection.vendorHint,
    detection,
    channels,
    endMeta,
    chunkCount,
  };
}

export function transcriptHasContent(t: AiTranscript): boolean {
  return (
    t.channels.content.length > 0 ||
    t.channels.reasoning.length > 0 ||
    t.channels.tools.length > 0 ||
    Boolean(t.endMeta.finishReason) ||
    Boolean(t.endMeta.usage)
  );
}
