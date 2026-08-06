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

/**
 * Doubao.com web SSE (real capture):
 * - block_type 10040 = thinking container (thinking_block)
 * - Child text_block with parent_id → thinking container = reasoning
 * - block_type 10025 = search_query_result_block → Tools (web_search)
 * - Top-level text_block (no thinking parent) = content
 * - CHUNK_DELTA continues the last text channel (reasoning or content)
 * - Ignore tts_content (patch_object 111) and user FULL_MSG_NOTIFY
 */
function mergeDoubaoWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): { channels: AiTranscriptChannels; endMeta: AiEndMeta; chunkCount: number } {
  let content = "";
  let reasoning = "";
  const tools: AiToolCall[] = [];
  let chunkCount = 0;
  const endMeta: AiEndMeta = {};
  const thinkingBlockIds = new Set<string>();
  /** CHUNK_DELTA has no block id — follow the last text-bearing channel. */
  let deltaChannel: "content" | "reasoning" = "content";

  const pushText = (text: string, channel: "content" | "reasoning") => {
    if (!text) return;
    chunkCount++;
    deltaChannel = channel;
    if (channel === "reasoning") reasoning += text;
    else content += text;
  };

  const looksLikeDeepThinkIcon = (url: unknown): boolean =>
    typeof url === "string" && /Deep_Think/i.test(url);

  const ingestSearchBlock = (block: Record<string, unknown>): void => {
    const bag = isRecord(block.content) ? block.content : null;
    const search = bag && isRecord(bag.search_query_result_block) ? bag.search_query_result_block : null;
    if (!search) return;
    const queries = Array.isArray(search.queries)
      ? search.queries.filter((q): q is string => typeof q === "string")
      : [];
    const resultsRaw = Array.isArray(search.results) ? search.results : [];
    const results: Array<Record<string, unknown>> = [];
    for (const item of resultsRaw) {
      if (!isRecord(item)) continue;
      const card = isRecord(item.text_card) ? item.text_card : item;
      const title = asString(card.title) ?? "";
      const url = asString(card.url) ?? "";
      const snippet = asString(card.summary) ?? asString(card.snippet) ?? "";
      const site = asString(card.sitename) ?? asString(card.site_name) ?? "";
      const cite =
        typeof card.index === "number" || typeof card.index === "string" ? card.index : undefined;
      if (!title && !url && !snippet) continue;
      results.push({
        title,
        url,
        snippet,
        site_name: site,
        cite_index: cite,
      });
    }
    // Skip query-only placeholders until results arrive (same block_id updates later).
    if (queries.length === 0 && results.length === 0) return;

    const blockId = asString(block.block_id);
    const parentId = asString(block.parent_id);
    const underThinking = parentId != null && thinkingBlockIds.has(parentId);
    // scene 1 = live search in thinking; scene 2 = end-of-answer reference replay (same payload, new block_id).
    const scene = typeof search.scene === "number" ? search.scene : undefined;
    const fingerprint = `${queries.join("\u0001")}\u0000${results
      .map((r) => String(r.url || r.title || ""))
      .join("\u0001")}`;

    const payload = JSON.stringify({
      type: "SEARCH",
      queries,
      results,
      summary: asString(search.summary),
      scene,
    });

    const existingById = blockId != null ? tools.find((t) => t.id === blockId) : undefined;
    if (existingById && existingById.name === "web_search") {
      existingById.arguments = payload;
      chunkCount++;
      return;
    }

    const duplicate = tools.find((t) => {
      if (t.name !== "web_search") return false;
      try {
        const prev = JSON.parse(t.arguments) as { queries?: unknown; results?: unknown[] };
        const prevQueries = Array.isArray(prev.queries)
          ? prev.queries.filter((q): q is string => typeof q === "string")
          : [];
        const prevResults = Array.isArray(prev.results) ? prev.results : [];
        const prevFp = `${prevQueries.join("\u0001")}\u0000${prevResults
          .map((r) => {
            if (!isRecord(r)) return "";
            return String(r.url || r.title || "");
          })
          .join("\u0001")}`;
        return prevFp === fingerprint && fingerprint.length > 1;
      } catch {
        return false;
      }
    });
    if (duplicate) {
      // Keep the first (usually thinking-time) call; drop citation replay.
      return;
    }

    // Prefer not creating a lone scene=2 card when it has no thinking parent and no prior tool —
    // still allow it as fallback if it's the only search we ever see.
    if (scene === 2 && !underThinking && tools.some((t) => t.name === "web_search")) {
      return;
    }

    tools.push({
      index: tools.length,
      id: blockId,
      name: "web_search",
      arguments: payload,
    });
    chunkCount++;
  };

  const ingestContentBlocks = (blocks: unknown): void => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!isRecord(block)) continue;
      const blockType = typeof block.block_type === "number" ? block.block_type : undefined;
      const blockId = asString(block.block_id);
      const parentId = asString(block.parent_id);
      const bag = isRecord(block.content) ? block.content : null;

      if (blockType === 10040 || (bag && isRecord(bag.thinking_block))) {
        if (blockId) thinkingBlockIds.add(blockId);
        // Container only — text arrives in child blocks / CHUNK_DELTA.
        deltaChannel = "reasoning";
        continue;
      }

      if (blockType === 10025 || (bag && isRecord(bag.search_query_result_block))) {
        ingestSearchBlock(block);
        continue;
      }

      const textBlock = bag && isRecord(bag.text_block) ? bag.text_block : null;
      if (!textBlock) continue;
      const text = asString(textBlock.text);
      const underThinking =
        (parentId != null && thinkingBlockIds.has(parentId)) ||
        looksLikeDeepThinkIcon(textBlock.icon_url) ||
        looksLikeDeepThinkIcon(textBlock.icon_url_dark);
      const channel: "content" | "reasoning" = underThinking ? "reasoning" : "content";
      if (text) pushText(text, channel);
      else deltaChannel = channel;
    }
  };

  for (const ev of events) {
    const name = ev.event;
    const parsed = parseEventData(ev.data);
    if (!isRecord(parsed)) continue;

    if (name === "CHUNK_DELTA") {
      const text = asString(parsed.text);
      if (text) pushText(text, deltaChannel);
      continue;
    }

    if (name === "STREAM_MSG_NOTIFY") {
      const meta = isRecord(parsed.meta) ? parsed.meta : null;
      if (meta && meta.user_type === 1) continue;
      const bag = isRecord(parsed.content) ? parsed.content : parsed;
      if (isRecord(bag) && Array.isArray(bag.content_block)) {
        ingestContentBlocks(bag.content_block);
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
          ingestContentBlocks(pv.content_block);
        }
      }
      continue;
    }

    if (name === "SSE_REPLY_END") {
      if (typeof parsed.end_type === "number" && parsed.end_type === 1) {
        endMeta.finishReason = "SSE_REPLY_END";
        const attr = isRecord(parsed.msg_finish_attr) ? parsed.msg_finish_attr : null;
        if (attr && typeof attr.brief === "string" && !content) {
          content = attr.brief;
          chunkCount++;
        }
      }
      continue;
    }

    // Fallback for captures without event names
    if (typeof parsed.text === "string") {
      pushText(parsed.text, deltaChannel);
    } else if (typeof parsed.block_type === "number" || Array.isArray(parsed.content_block)) {
      ingestContentBlocks(Array.isArray(parsed.content_block) ? parsed.content_block : [parsed]);
    }
  }

  return {
    channels: { content, reasoning, tools },
    endMeta,
    chunkCount,
  };
}

/**
 * Kimi.com Connect+JSON (real capture / Bridge-compatible):
 * - mask chat.lastRequest / heartbeat → ignore
 * - mask message role=user → ignore; assistant status completed → finish
 * - block.multiStage / block.stage with STAGE_NAME_THINKING → reasoning channel
 * - delta.content / block.text.content → route by thinking block parent chain
 * - block.stage/block.search search payloads → Tools web_search
 */
function mergeKimiWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): { channels: AiTranscriptChannels; endMeta: AiEndMeta; chunkCount: number } {
  let content = "";
  let reasoning = "";
  const tools: AiToolCall[] = [];
  let chunkCount = 0;
  const endMeta: AiEndMeta = {};
  /** Blocks under STAGE_NAME_THINKING (multiStage / stage / descendants). */
  const thinkingBlockIds = new Set<string>();
  /** Latest full text snapshot per block (Kimi often sends cumulative block.text). */
  const blockTextSnapshots = new Map<string, string>();
  /** Incremental tool args keyed by block id. */
  const toolArgsByBlockId = new Map<string, string>();
  let thinkingActive = false;

  const stageEnded = (status: unknown): boolean =>
    status === "STAGE_STATUS_DONE" ||
    status === "STAGE_STATUS_END" ||
    status === "STAGE_STATUS_FINISHED" ||
    status === "STAGE_STATUS_CANCELLED" ||
    status === "STAGE_STATUS_COMPLETED";

  const isThinkingStageName = (name: unknown): boolean =>
    typeof name === "string" &&
    (name === "STAGE_NAME_THINKING" ||
      name === "STAGE_NAME_REASONING" ||
      name.includes("THINKING") ||
      name.includes("REASONING"));

  const isSearchStageName = (name: unknown): boolean =>
    typeof name === "string" &&
    (name === "STAGE_NAME_SEARCH" ||
      name === "STAGE_NAME_WEB_SEARCH" ||
      name === "STAGE_NAME_TOOL_SEARCH" ||
      name.includes("SEARCH"));

  const markThinkingBlock = (blockId: string | undefined): void => {
    if (blockId) thinkingBlockIds.add(blockId);
  };

  const underThinking = (parentId?: string, blockId?: string): boolean => {
    if (thinkingActive) return true;
    if (blockId && thinkingBlockIds.has(blockId)) return true;
    if (parentId && thinkingBlockIds.has(parentId)) return true;
    return false;
  };

  const pushText = (text: string, channel: "content" | "reasoning") => {
    if (!text) return;
    chunkCount++;
    if (channel === "reasoning") reasoning += text;
    else content += text;
  };

  /** Push block.text — dedupe cumulative snapshots for thinking blocks. */
  const pushBlockText = (blockId: string | undefined, text: string, channel: "content" | "reasoning") => {
    if (!text) return;
    if (channel === "reasoning" && blockId) {
      const prev = blockTextSnapshots.get(blockId) ?? "";
      let delta = text;
      if (text.startsWith(prev)) {
        delta = text.slice(prev.length);
      } else if (prev.startsWith(text)) {
        return;
      }
      if (text.length >= prev.length) blockTextSnapshots.set(blockId, text);
      pushText(delta, "reasoning");
      return;
    }
    pushText(text, channel);
  };

  const upsertToolCall = (
    blockId: string | undefined,
    name: string,
    queries: string[],
    results: Array<Record<string, unknown>>,
  ): void => {
    if (queries.length === 0 && results.length === 0) return;

    const mergeArgs = (
      prevArgs: string,
      nextQueries: string[],
      nextResults: Array<Record<string, unknown>>,
    ): string => {
      let prevQueries: string[] = [];
      let prevResults: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(prevArgs) as {
          queries?: string[];
          results?: Array<Record<string, unknown>>;
        };
        prevQueries = Array.isArray(parsed.queries) ? parsed.queries : [];
        prevResults = Array.isArray(parsed.results) ? parsed.results : [];
      } catch {
        // ignore
      }
      const mergedQueries = [...new Set([...prevQueries, ...nextQueries])];
      const seen = new Set(
        prevResults.map((r) => String(r.url || r.title || r.ref_index || "")),
      );
      const mergedResults = [...prevResults];
      for (const r of nextResults) {
        const key = String(r.url || r.title || r.ref_index || "");
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        mergedResults.push(r);
      }
      return JSON.stringify({ type: "SEARCH", queries: mergedQueries, results: mergedResults });
    };

    const existingById = blockId
      ? tools.find((t) => t.id === blockId && t.name === name)
      : undefined;
    if (existingById) {
      existingById.arguments = mergeArgs(existingById.arguments, queries, results);
      chunkCount++;
      return;
    }

    if (name === "web_search") {
      const orphan = tools.find((t) => t.name === "web_search");
      if (orphan) {
        if (blockId) orphan.id = blockId;
        orphan.arguments = mergeArgs(orphan.arguments, queries, results);
        chunkCount++;
        return;
      }
    }

    const payload = JSON.stringify({ type: "SEARCH", queries, results });
    tools.push({
      index: tools.length,
      id: blockId,
      name,
      arguments: payload,
    });
    chunkCount++;
  };

  const ingestSearchPayload = (search: Record<string, unknown>, blockId?: string): void => {
    const results: Array<Record<string, unknown>> = [];
    const pushCard = (card: Record<string, unknown>) => {
      const base = isRecord(card.base) ? card.base : card;
      const title = asString(base.title) ?? "";
      const url = asString(base.url) ?? "";
      const snippet = asString(base.snippet) ?? asString(base.summary) ?? "";
      const site = asString(base.siteName) ?? asString(base.site_name) ?? "";
      if (!title && !url && !snippet) return;
      results.push({
        title,
        url,
        snippet,
        site_name: site,
        ref_index: asString(card.refIndex) ?? asString(card.ref_index),
      });
    };

    if (Array.isArray(search.results)) {
      for (const item of search.results) {
        if (!isRecord(item)) continue;
        if (isRecord(item.searchResult)) pushCard(item.searchResult);
        else if (isRecord(item.search)) pushCard(item.search);
        else pushCard(item);
      }
    } else if (Array.isArray(search.searchChunks)) {
      for (const item of search.searchChunks) {
        if (isRecord(item)) pushCard(item);
      }
    } else if (isRecord(search.base) || asString(search.title) || asString(search.url)) {
      pushCard(search);
    }

    const queries: string[] = [];
    if (typeof search.query === "string") queries.push(search.query);
    if (Array.isArray(search.queries)) {
      for (const q of search.queries) {
        if (typeof q === "string") queries.push(q);
      }
    }
    if (queries.length === 0 && results.length === 0) return;
    upsertToolCall(blockId, "web_search", queries, results);
  };

  const parseToolQueries = (argsText: string): string[] => {
    try {
      const parsed = JSON.parse(argsText) as { queries?: unknown };
      if (!Array.isArray(parsed.queries)) return [];
      return parsed.queries.filter((q): q is string => typeof q === "string");
    } catch {
      return [];
    }
  };

  const ingestKimiTool = (block: Record<string, unknown>, blockId?: string): void => {
    const toolBag = isRecord(block.tool) ? block.tool : null;
    if (!toolBag) return;

    const toolBlockId =
      blockId ?? asString(toolBag.toolCallId) ?? asString(toolBag.tool_call_id);
    const name = asString(toolBag.name) ?? "web_search";

    const argsFragment = asString(toolBag.args);
    let queries: string[] = [];
    if (argsFragment && toolBlockId) {
      const prev = toolArgsByBlockId.get(toolBlockId) ?? "";
      const combined =
        argsFragment.startsWith("{") && argsFragment.endsWith("}")
          ? argsFragment
          : prev + argsFragment;
      toolArgsByBlockId.set(toolBlockId, combined);
      queries = parseToolQueries(combined);
    }

    const results: Array<Record<string, unknown>> = [];
    if (Array.isArray(toolBag.contents)) {
      for (const item of toolBag.contents) {
        if (!isRecord(item)) continue;
        const card = isRecord(item.searchResult) ? item.searchResult : item;
        const base = isRecord(card.base) ? card.base : card;
        const title = asString(base.title) ?? "";
        const url = asString(base.url) ?? "";
        const snippet = asString(base.snippet) ?? asString(base.summary) ?? "";
        const site = asString(base.siteName) ?? asString(base.site_name) ?? "";
        if (!title && !url && !snippet) continue;
        results.push({
          title,
          url,
          snippet,
          site_name: site,
          ref_index: asString(card.refIndex) ?? asString(card.ref_index),
        });
      }
    }

    if (queries.length > 0 || results.length > 0) {
      upsertToolCall(toolBlockId, name, queries, results);
    }
  };

  const ingestMessageRefs = (msg: Record<string, unknown>): void => {
    const refs = isRecord(msg.refs) ? msg.refs : null;
    if (refs && Array.isArray(refs.searchChunks) && refs.searchChunks.length > 0) {
      ingestSearchPayload({ searchChunks: refs.searchChunks });
    }

    if (Array.isArray(msg.references)) {
      for (const ref of msg.references) {
        if (!isRecord(ref) || !Array.isArray(ref.items)) continue;
        const chunks: unknown[] = [];
        for (const item of ref.items) {
          if (!isRecord(item)) continue;
          if (isRecord(item.search)) chunks.push(item.search);
        }
        if (chunks.length > 0) ingestSearchPayload({ searchChunks: chunks });
      }
    }
  };

  const ingestStage = (
    stage: Record<string, unknown>,
    blockId?: string,
    parentId?: string,
  ): void => {
    const name = stage.name;
    if (isThinkingStageName(name)) {
      markThinkingBlock(blockId);
      if (parentId) markThinkingBlock(parentId);
      thinkingActive = !stageEnded(stage.status);
    } else if (isSearchStageName(name)) {
      if (isRecord(stage.search)) ingestSearchPayload(stage.search, blockId);
    } else if (stageEnded(stage.status) && parentId && thinkingBlockIds.has(parentId)) {
      thinkingActive = false;
    }

    const stageText =
      asString(stage.content) ??
      asString(stage.text) ??
      (isRecord(stage.text) ? asString(stage.text.content) : undefined);
    if (stageText) {
      pushBlockText(
        blockId,
        stageText,
        isThinkingStageName(name) || underThinking(parentId, blockId) ? "reasoning" : "content",
      );
    }

    if (isRecord(stage.search)) ingestSearchPayload(stage.search, blockId);
    if (Array.isArray(stage.results)) {
      ingestSearchPayload({ results: stage.results, query: stage.query, queries: stage.queries }, blockId);
    }
  };

  const ingestBlock = (block: Record<string, unknown>): void => {
    const blockId = asString(block.id);
    const parentId = asString(block.parentId) ?? asString(block.parent_id);

    const multi = isRecord(block.multiStage) ? block.multiStage : null;
    if (multi && Array.isArray(multi.stages)) {
      for (const stage of multi.stages) {
        if (!isRecord(stage)) continue;
        if (isThinkingStageName(stage.name)) {
          markThinkingBlock(blockId);
          thinkingActive = !stageEnded(stage.status);
        }
        if (isSearchStageName(stage.name) && isRecord(stage.search)) {
          ingestSearchPayload(stage.search, blockId);
        }
      }
    }

    const stage = isRecord(block.stage) ? block.stage : null;
    if (stage) ingestStage(stage, blockId, parentId);

    if (isRecord(block.search)) {
      ingestSearchPayload(block.search, blockId ?? asString(block.search.id));
    }
    if (Array.isArray(block.results)) {
      ingestSearchPayload(
        { results: block.results, query: block.query, queries: block.queries },
        blockId,
      );
    }

    const thinkBag = isRecord(block.think)
      ? block.think
      : isRecord(block.thinking)
        ? block.thinking
        : null;
    if (thinkBag) {
      markThinkingBlock(blockId);
      if (parentId) markThinkingBlock(parentId);
      const thinkText =
        asString(thinkBag.content) ??
        asString(thinkBag.text) ??
        (isRecord(thinkBag.text) ? asString(thinkBag.text.content) : undefined);
      if (thinkText) pushText(thinkText, "reasoning");
    }

    ingestKimiTool(block, blockId);

    const textBag = isRecord(block.text) ? block.text : null;
    const text = textBag ? asString(textBag.content) : undefined;
    if (text) {
      pushBlockText(blockId, text, underThinking(parentId, blockId) ? "reasoning" : "content");
    }

    if (isRecord(block.exception)) {
      const err = isRecord(block.exception.error) ? block.exception.error : null;
      const reason = err ? asString(err.reason) : undefined;
      if (reason) endMeta.finishReason = reason;
    }
  };

  const ingestDelta = (parsed: Record<string, unknown>): void => {
    const delta = isRecord(parsed.delta) ? parsed.delta : null;
    if (!delta) return;

    const reasoningText =
      asString(delta.reasoning_content) ??
      asString(delta.reasoningContent) ??
      asString(delta.reasoning);
    if (reasoningText) pushText(reasoningText, "reasoning");

    const text = asString(delta.content);
    if (!text) return;

    const blockRef = isRecord(parsed.block) ? parsed.block : null;
    const parentId =
      (blockRef ? asString(blockRef.parentId) ?? asString(blockRef.parent_id) : undefined) ??
      asString(parsed.parentId);
    const blockId = blockRef ? asString(blockRef.id) : asString(parsed.blockId);
    pushText(text, underThinking(parentId, blockId) ? "reasoning" : "content");
  };

  for (const ev of events) {
    const parsed = parseEventData(ev.data);
    if (!isRecord(parsed)) continue;

    if (parsed.heartbeat != null) continue;

    const mask = typeof parsed.mask === "string" ? parsed.mask : ev.event;
    if (mask === "chat.lastRequest") continue;

    if (isRecord(parsed.message)) {
      const msg = parsed.message;
      const role = asString(msg.role);
      if (role !== "user") {
        ingestMessageRefs(msg);
        const status = asString(msg.status);
        if (status === "MESSAGE_STATUS_COMPLETED") {
          endMeta.finishReason = endMeta.finishReason ?? "stop";
        }
      }
      continue;
    }

    ingestDelta(parsed);

    if (isRecord(parsed.block)) {
      ingestBlock(parsed.block);
    }
  }

  return {
    channels: { content, reasoning, tools },
    endMeta,
    chunkCount,
  };
}

/**
 * Qianwen plan_cot often ships newline-separated cumulative lines where each line
 * restates the full thought so far. Collapse those runs to the last line only.
 */
function collapseCumulativeLines(text: string): string {
  if (!text) return text;
  const normalized = text.replace(/\n+$/, "");
  const rawLines = normalized.split("\n");
  if (rawLines.length <= 1) return normalized;

  const out: string[] = [];
  let i = 0;
  while (i < rawLines.length) {
    let stackEnd = i;
    while (stackEnd + 1 < rawLines.length) {
      const cur = rawLines[stackEnd].trimEnd();
      const next = rawLines[stackEnd + 1].trimEnd();
      if (!next) break;
      if (cur && next.startsWith(cur)) {
        stackEnd++;
      } else {
        break;
      }
    }
    if (stackEnd > i) {
      out.push(rawLines[stackEnd]);
      i = stackEnd + 1;
    } else {
      out.push(rawLines[i]);
      i++;
    }
  }
  return out.join("\n");
}

/**
 * Qianwen / Tongyi web AgentProxy SSE:
 * - plan_cot/post → reasoning (latest snapshot; collapse stacked lines)
 * - multi_load/iframe deep_think.think_content → reasoning (latest snapshot)
 * - multi_load/iframe msg.content (after [(deep_think)] prefix) → content
 * - bar/progress cot query + result list → tools web_search
 * - bar/iframe sources + source_group_web → tools web_search
 */
function mergeQianwenWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): { channels: AiTranscriptChannels; endMeta: AiEndMeta; chunkCount: number } {
  let content = "";
  let reasoning = "";
  const tools: AiToolCall[] = [];
  let chunkCount = 0;
  const endMeta: AiEndMeta = {};
  const snapshots = new Map<string, string>();
  let planCotLatest = "";
  let deepThinkLatest = "";

  const pushSnapshot = (key: string, full: string, channel: "content" | "reasoning"): void => {
    if (!full) return;
    const prev = snapshots.get(key) ?? "";
    let delta = full;
    if (full.startsWith(prev)) {
      delta = full.slice(prev.length);
    } else if (prev.startsWith(full)) {
      return;
    }
    if (full.length >= prev.length) snapshots.set(key, full);
    if (!delta) return;
    chunkCount++;
    if (channel === "reasoning") reasoning += delta;
    else content += delta;
  };

  const extractSourceResults = (list: unknown[]): Array<Record<string, unknown>> => {
    const results: Array<Record<string, unknown>> = [];
    for (const raw of list) {
      if (!isRecord(raw)) continue;
      results.push({
        title: raw.title,
        url: raw.url ?? raw.raw_url ?? raw.normalized_url,
        snippet: raw.summary ?? raw.snippet,
        site_name: raw.host_name ?? raw.sc_name ?? raw.name,
        publish_time: raw.publish_time,
        ref_num: raw.ref_num,
      });
    }
    return results;
  };

  const upsertWebSearch = (
    queries: string[],
    results: Array<Record<string, unknown>>,
  ): void => {
    if (queries.length === 0 && results.length === 0) return;

    const mergeArgs = (
      prevArgs: string,
      nextQueries: string[],
      nextResults: Array<Record<string, unknown>>,
    ): string => {
      let prevQueries: string[] = [];
      let prevResults: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(prevArgs) as {
          queries?: string[];
          results?: Array<Record<string, unknown>>;
        };
        prevQueries = Array.isArray(parsed.queries) ? parsed.queries : [];
        prevResults = Array.isArray(parsed.results) ? parsed.results : [];
      } catch {
        // ignore
      }
      const mergedQueries = [...new Set([...prevQueries, ...nextQueries])];
      const seen = new Set(
        prevResults.map((r) => String(r.url || r.title || r.ref_num || "")),
      );
      const mergedResults = [...prevResults];
      for (const r of nextResults) {
        const key = String(r.url || r.title || r.ref_num || "");
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        mergedResults.push(r);
      }
      return JSON.stringify({ type: "SEARCH", queries: mergedQueries, results: mergedResults });
    };

    const orphan = tools.find((t) => t.name === "web_search");
    if (orphan) {
      orphan.arguments = mergeArgs(orphan.arguments, queries, results);
      chunkCount++;
      return;
    }

    tools.push({
      index: tools.length,
      name: "web_search",
      arguments: JSON.stringify({ type: "SEARCH", queries, results }),
    });
    chunkCount++;
  };

  const ingestSourceGroupWeb = (item: Record<string, unknown>): void => {
    const bag = isRecord(item.content) ? item.content : null;
    const list = bag && Array.isArray(bag.list) ? bag.list : [];
    const results: Array<Record<string, unknown>> = [];
    for (const group of list) {
      if (!isRecord(group)) continue;
      const groupContent = isRecord(group.content) ? group.content : null;
      const inner = groupContent && Array.isArray(groupContent.list) ? groupContent.list : [];
      results.push(...extractSourceResults(inner));
    }
    if (results.length > 0) upsertWebSearch([], results);
  };

  for (const ev of events) {
    const parsed = parseEventData(ev.data);
    if (!isRecord(parsed)) continue;
    const data = isRecord(parsed.data) ? parsed.data : null;
    if (!data) continue;

    const extra = isRecord(data.extra_info) ? data.extra_info : null;
    if (extra && (extra.sse_end === "1" || extra.sse_end === 1)) {
      endMeta.finishReason = endMeta.finishReason ?? "stop";
    }

    const messages = Array.isArray(data.messages) ? data.messages : [];
    for (const msg of messages) {
      if (!isRecord(msg)) continue;
      const mime = asString(msg.mime_type) ?? "";

      if (mime === "plan_cot/post") {
        const text = asString(msg.content);
        if (text && text.length >= planCotLatest.length) {
          planCotLatest = text;
          chunkCount++;
        }
        continue;
      }

      if (mime === "bar/progress") {
        const md = isRecord(msg.meta_data) ? msg.meta_data : null;
        if (!md) continue;
        if (md.type === "cot" && isRecord(md.content)) {
          const list = Array.isArray(md.content.list) ? md.content.list : [];
          const queries = list
            .filter(isRecord)
            .map((item) => asString(item.query))
            .filter((q): q is string => Boolean(q));
          if (queries.length > 0) upsertWebSearch(queries, []);
        } else if (Array.isArray(md.list)) {
          const results = extractSourceResults(md.list);
          if (results.length > 0) upsertWebSearch([], results);
        }
        continue;
      }

      if (mime === "bar/iframe") {
        const md = isRecord(msg.meta_data) ? msg.meta_data : null;
        const sources = md && Array.isArray(md.sources) ? md.sources : [];
        const results: Array<Record<string, unknown>> = [];
        for (const src of sources) {
          if (!isRecord(src)) continue;
          const srcContent = isRecord(src.content) ? src.content : null;
          const list = srcContent && Array.isArray(srcContent.list) ? srcContent.list : [];
          results.push(...extractSourceResults(list));
        }
        if (results.length > 0) upsertWebSearch([], results);
        continue;
      }

      if (mime === "multi_load/iframe") {
        const md = isRecord(msg.meta_data) ? msg.meta_data : null;
        const multiLoad = md && Array.isArray(md.multi_load) ? md.multi_load : [];
        for (const item of multiLoad) {
          if (!isRecord(item)) continue;
          if (item.type === "deep_think" && isRecord(item.content)) {
            const think = asString(item.content.think_content);
            if (think && think.length >= deepThinkLatest.length) {
              deepThinkLatest = think;
              chunkCount++;
            }
          } else if (item.type === "source_group_web") {
            ingestSourceGroupWeb(item);
          } else {
            const html = asString(item.html);
            if (html && html.length > 20) {
              pushSnapshot(`ml:${String(item.type)}:html`, html, "content");
            }
            const itemContent = item.content;
            if (typeof itemContent === "string" && itemContent.length > 20) {
              pushSnapshot(`ml:${String(item.type)}:text`, itemContent, "content");
            } else if (isRecord(itemContent)) {
              const text = asString(itemContent.text) ?? asString(itemContent.content);
              if (text && text.length > 20) {
                pushSnapshot(`ml:${String(item.type)}:text`, text, "content");
              }
            }
          }
        }

        const rawContent = asString(msg.content);
        if (rawContent) {
          const stripped = rawContent.replace(/^\[\(deep_think\)\]\s*/, "");
          if (stripped) pushSnapshot("multi_load_content", stripped, "content");
        }
        continue;
      }

      if (
        (mime.endsWith("/post") || mime.includes("text") || mime.includes("markdown")) &&
        mime !== "plan_cot/post" &&
        mime !== "signal/post"
      ) {
        const text = asString(msg.content);
        if (text && !text.startsWith("[(")) {
          pushSnapshot(`mime:${mime}`, text, "content");
        }
      }
    }
  }

  const planCotCollapsed = planCotLatest ? collapseCumulativeLines(planCotLatest) : "";
  const reasoningParts: string[] = [];
  if (planCotCollapsed) reasoningParts.push(planCotCollapsed);
  if (deepThinkLatest) reasoningParts.push(deepThinkLatest);
  reasoning = reasoningParts.join("\n\n");

  return {
    channels: { content, reasoning, tools },
    endMeta,
    chunkCount,
  };
}

/**
 * ChatGLM / Zhipu Qingyan web SSE:
 * - parts[].content[] type=think → reasoning (cumulative snapshot)
 * - parts[].content[] type=text → content (cumulative snapshot)
 * - parts[].content[] type=tool_calls → tools (skip finish)
 * - top-level / part status finish → endMeta
 */
function mergeZhipuWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): { channels: AiTranscriptChannels; endMeta: AiEndMeta; chunkCount: number } {
  let thinkLatest = "";
  let textLatest = "";
  const tools: AiToolCall[] = [];
  let chunkCount = 0;
  const endMeta: AiEndMeta = {};
  const seenGenericToolKeys = new Set<string>();

  const isSearchToolName = (name: string): boolean => {
    const n = name.toLowerCase();
    return (
      n === "search" ||
      n === "web_search" ||
      n === "websearch" ||
      n === "find" ||
      n === "browse" ||
      n.includes("search")
    );
  };

  const parseJsonish = (raw: unknown): unknown => {
    if (typeof raw === "string") {
      const t = raw.trim();
      if (!t) return null;
      try {
        return JSON.parse(t);
      } catch {
        return raw;
      }
    }
    return raw;
  };

  const stringifyArgs = (raw: unknown): string => {
    if (typeof raw === "string") return raw || "{}";
    if (raw == null) return "{}";
    try {
      return JSON.stringify(raw);
    } catch {
      return "{}";
    }
  };

  const stripHtml = (s: string): string =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const normalizeResult = (raw: unknown): Record<string, unknown> | null => {
    if (!isRecord(raw)) return null;
    const url =
      asString(raw.url) ??
      asString(raw.link) ??
      asString(raw.href) ??
      asString(raw.raw_url) ??
      asString(raw.normalized_url);
    const title = asString(raw.title) ?? asString(raw.name) ?? asString(raw.source);
    if (!url && !title) return null;
    const snippetRaw =
      asString(raw.snippet) ??
      asString(raw.summary) ??
      asString(raw.desc) ??
      asString(raw.description) ??
      asString(raw.text);
    return {
      title,
      url,
      snippet: snippetRaw ? stripHtml(snippetRaw) : undefined,
      site_name:
        asString(raw.site_name) ??
        asString(raw.host_name) ??
        asString(raw.sc_name) ??
        asString(raw.media) ??
        asString(raw.source),
      publish_time: raw.publish_time ?? raw.published_at ?? raw.time,
      cite_index: raw.cite_index ?? raw.ref_num ?? raw.index ?? raw.ref,
      favicon: asString(raw.favicon),
      match_key: asString(raw.match_key),
    };
  };

  const extractResults = (raw: unknown): Array<Record<string, unknown>> => {
    const out: Array<Record<string, unknown>> = [];
    const pushList = (list: unknown): void => {
      if (!Array.isArray(list)) return;
      for (const item of list) {
        const n = normalizeResult(item);
        if (n) out.push(n);
      }
    };

    const parsed = parseJsonish(raw);
    if (Array.isArray(parsed)) {
      pushList(parsed);
      return out;
    }
    if (!isRecord(parsed)) return out;
    pushList(parsed.results);
    pushList(parsed.search_results);
    pushList(parsed.sources);
    pushList(parsed.citations);
    pushList(parsed.docs);
    pushList(parsed.items);
    pushList(parsed.list);
    pushList(parsed.data);
    if (isRecord(parsed.search)) {
      pushList(parsed.search.results);
      pushList(parsed.search.search_results);
      pushList(parsed.search.sources);
    }
    const single = normalizeResult(parsed);
    if (single) out.push(single);
    return out;
  };

  const extractQueries = (raw: unknown): string[] => {
    const out: string[] = [];
    const push = (q: unknown): void => {
      if (typeof q === "string" && q.trim()) out.push(q.trim());
    };
    const fromItem = (item: unknown): void => {
      if (typeof item === "string") {
        push(item);
        return;
      }
      if (!isRecord(item)) return;
      push(item.q);
      push(item.query);
      push(item.keyword);
      // Do not use item.text here — Zhipu search_results reuse "text" for HTML snippets.
    };

    const pushQueryList = (list: unknown): void => {
      if (!Array.isArray(list)) return;
      for (const item of list) fromItem(item);
    };

    const parsed = parseJsonish(raw);
    if (typeof parsed === "string") {
      push(parsed);
      return [...new Set(out)];
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) fromItem(item);
      return [...new Set(out)];
    }
    if (!isRecord(parsed)) return out;
    push(parsed.q);
    push(parsed.query);
    push(parsed.keyword);
    pushQueryList(parsed.queries);
    pushQueryList(parsed.search_query); // Zhipu: {"search_query":[{"q":"..."}]}
    pushQueryList(parsed.search_queries);
    return [...new Set(out)];
  };

  const upsertWebSearch = (
    queries: string[],
    results: Array<Record<string, unknown>>,
    id?: string,
  ): void => {
    if (queries.length === 0 && results.length === 0) return;

    const mergeArgs = (
      prevArgs: string,
      nextQueries: string[],
      nextResults: Array<Record<string, unknown>>,
    ): string => {
      let prevQueries: string[] = [];
      let prevResults: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(prevArgs) as {
          queries?: string[];
          results?: Array<Record<string, unknown>>;
        };
        prevQueries = Array.isArray(parsed.queries) ? parsed.queries : [];
        prevResults = Array.isArray(parsed.results) ? parsed.results : [];
      } catch {
        // ignore
      }
      const mergedQueries = [...new Set([...prevQueries, ...nextQueries])];
      const seen = new Set(
        prevResults.map((r) => String(r.url || r.title || r.cite_index || "")),
      );
      const mergedResults = [...prevResults];
      for (const r of nextResults) {
        const key = String(r.url || r.title || r.cite_index || "");
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        mergedResults.push(r);
      }
      return JSON.stringify({ type: "SEARCH", queries: mergedQueries, results: mergedResults });
    };

    const orphan = tools.find((t) => t.name === "web_search");
    if (orphan) {
      orphan.arguments = mergeArgs(orphan.arguments, queries, results);
      if (id && !orphan.id) orphan.id = id;
      chunkCount++;
      return;
    }

    tools.push({
      index: tools.length,
      id,
      name: "web_search",
      arguments: JSON.stringify({ type: "SEARCH", queries, results }),
    });
    chunkCount++;
  };

  const upsertGenericTool = (name: string, args: string, id?: string): void => {
    if (!name || name === "finish") return;
    if (isSearchToolName(name)) return;
    const key = `${name}:${args}`;
    if (seenGenericToolKeys.has(key)) return;
    seenGenericToolKeys.add(key);
    const existing = tools.find((t) => t.name === name && (!id || t.id === id));
    if (existing) {
      existing.arguments = args;
      chunkCount++;
      return;
    }
    tools.push({ index: tools.length, id, name, arguments: args });
    chunkCount++;
  };

  const ingestToolCalls = (raw: unknown): void => {
    const items: unknown[] = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      const name =
        asString(item.name) ??
        (isRecord(item.function) ? asString(item.function.name) : undefined) ??
        "";
      if (!name || name === "finish") continue;

      const argsRaw =
        item.arguments ??
        (isRecord(item.function) ? item.function.arguments : undefined);
      const argsText = stringifyArgs(argsRaw);
      const id = asString(item.id) ?? (isRecord(item.function) ? asString(item.function.id) : undefined);

      const siblingResults = [
        ...extractResults(item.results),
        ...extractResults(item.sources),
        ...extractResults(item.citations),
        ...extractResults(item.output),
        ...extractResults(item.content),
        ...extractResults(item.tool_result),
      ];

      if (isSearchToolName(name)) {
        const queries = extractQueries(argsRaw);
        const resultsFromArgs = extractResults(argsRaw).filter((r) => Boolean(r.url || r.title));
        // Query-shaped objects ({q, recency}) must not be treated as source results.
        const argLooksLikeQueriesOnly =
          Array.isArray(parseJsonish(argsRaw)) &&
          resultsFromArgs.length === 0 &&
          queries.length > 0;
        upsertWebSearch(
          queries,
          argLooksLikeQueriesOnly ? siblingResults : [...resultsFromArgs, ...siblingResults],
          id,
        );
        continue;
      }

      upsertGenericTool(name, argsText, id);
    }
  };

  const ingestSearchishValue = (raw: unknown): void => {
    const queries = extractQueries(raw);
    const results = extractResults(raw);
    if (queries.length > 0 || results.length > 0) upsertWebSearch(queries, results);
  };

  const ingestMeta = (meta: unknown): void => {
    if (!isRecord(meta)) return;
    ingestSearchishValue(meta.results);
    ingestSearchishValue(meta.sources);
    ingestSearchishValue(meta.citations);
    ingestSearchishValue(meta.browser);
    ingestSearchishValue(meta.search);
    ingestSearchishValue(meta.tool_result_extra);
    if (isRecord(meta.auto_glm_data)) ingestSearchishValue(meta.auto_glm_data);
  };

  for (const ev of events) {
    const parsed = parseEventData(ev.data);
    if (!isRecord(parsed)) continue;

    if (parsed.status === "finish" || parsed.status === "finished" || parsed.status === "done") {
      endMeta.finishReason = endMeta.finishReason ?? "stop";
    }

    ingestMeta(parsed.meta_data);

    // Top-level search payloads (some GLM variants).
    if (parsed.phase === "search" || parsed.type === "web_search" || parsed.type === "search") {
      ingestSearchishValue(parsed);
    }

    const parts = Array.isArray(parsed.parts) ? parsed.parts : [];
    for (const part of parts) {
      if (!isRecord(part)) continue;
      if (part.status === "finish" || part.status === "finished") {
        endMeta.finishReason = endMeta.finishReason ?? "stop";
      }
      if (typeof part.model === "string" && !endMeta.model) {
        endMeta.model = part.model;
      }

      ingestMeta(part.meta_data);

      const contentItems = Array.isArray(part.content) ? part.content : [];
      for (const item of contentItems) {
        if (!isRecord(item)) continue;
        const typ = asString(item.type) ?? "";

        if (typ === "think") {
          const think = asString(item.think) ?? asString(item.text) ?? "";
          if (think && think.length >= thinkLatest.length) {
            thinkLatest = think;
            chunkCount++;
          }
          continue;
        }

        if (typ === "text") {
          const text = asString(item.text) ?? "";
          if (text && text.length >= textLatest.length) {
            textLatest = text;
            chunkCount++;
          }
          continue;
        }

        if (typ === "tool_calls") {
          ingestToolCalls(item.tool_calls);
          continue;
        }

        // Zhipu echoes the search call again under tool_result; results live in meta.
        if (typ === "tool_result") {
          if (item.tool_calls != null) ingestToolCalls(item.tool_calls);
          ingestSearchishValue(item);
          continue;
        }

        // Search / browse / citation payloads appear under various type names.
        if (
          typ === "browser" ||
          typ === "search" ||
          typ === "web_search" ||
          typ === "search_result" ||
          typ === "quote" ||
          typ === "citation" ||
          typ === "execution_output" ||
          typ === "sources"
        ) {
          ingestSearchishValue(item);
          ingestSearchishValue(item.browser);
          ingestSearchishValue(item.search);
          ingestSearchishValue(item.tool_result);
          ingestSearchishValue(item.content);
          ingestSearchishValue(item.text);
          continue;
        }

        if (
          Array.isArray(item.results) ||
          Array.isArray(item.sources) ||
          Array.isArray(item.citations)
        ) {
          ingestSearchishValue(item);
        }
      }
    }
  }

  return {
    channels: {
      content: textLatest,
      reasoning: thinkLatest,
      tools,
    },
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
  } else if (detection.profile === "kimi-web") {
    const merged = mergeKimiWeb(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  } else if (detection.profile === "qianwen-web") {
    const merged = mergeQianwenWeb(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  } else if (detection.profile === "zhipu-web") {
    const merged = mergeZhipuWeb(events);
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
