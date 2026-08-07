import type { SseEvent } from "../types";
import type { AiEndMeta, AiToolCall, AiConversationChannels, MergeChannelsResult } from "./types";
import { isRecord, parseEventData } from "./helpers";

export type FragType = "THINK" | "RESPONSE" | "SEARCH" | "TIP" | "OTHER";

export function fragmentType(raw: unknown): FragType {
  if (!isRecord(raw) || typeof raw.type !== "string") return "OTHER";
  if (raw.type === "THINK") return "THINK";
  if (raw.type === "RESPONSE") return "RESPONSE";
  if (raw.type === "SEARCH") return "SEARCH";
  if (raw.type === "TIP") return "TIP";
  return "OTHER";
}

export function appendByFragType(
  typ: FragType,
  text: string,
  channels: { content: string; reasoning: string },
): void {
  if (!text) return;
  if (typ === "THINK") channels.reasoning += text;
  else if (typ === "RESPONSE") channels.content += text;
}

export function ingestSearchFragment(frag: Record<string, unknown>, tools: AiToolCall[]): void {
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

export function ingestFragment(
  frag: unknown,
  state: { current: FragType; channels: AiConversationChannels; chunkCount: number },
): void {
  if (!isRecord(frag)) return;
  const typ = fragmentType(frag);
  if (typ === "SEARCH") {
    ingestSearchFragment(frag, state.channels.tools);
    state.chunkCount++;
    return;
  }
  if (typ === "TIP") {
    // Skip tip/disclaimer fragments.
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

export function applyDeepseekPatch(
  path: string,
  op: string,
  value: unknown,
  state: {
    current: FragType;
    channels: AiConversationChannels;
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
export function mergeDeepseekWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): MergeChannelsResult {
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
