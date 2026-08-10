import type { SseEvent } from "../types";
import type { AiEndMeta, AiToolCall, MergeChannelsResult } from "./types";
import { asString, isRecord, parseEventData } from "./helpers";

export type KimiWebMergeState = {
  content: string;
  reasoning: string;
  tools: AiToolCall[];
  chunkCount: number;
  endMeta: AiEndMeta;
  /** Blocks under STAGE_NAME_THINKING (multiStage / stage / descendants). */
  thinkingBlockIds: Set<string>;
  /** Latest full text snapshot per block (Kimi often sends cumulative block.text). */
  blockTextSnapshots: Map<string, string>;
  /** Incremental tool args keyed by block id. */
  toolArgsByBlockId: Map<string, string>;
  thinkingActive: boolean;
};

export function createKimiWebMergeState(): KimiWebMergeState {
  return {
    content: "",
    reasoning: "",
    tools: [],
    chunkCount: 0,
    endMeta: {},
    thinkingBlockIds: new Set(),
    blockTextSnapshots: new Map(),
    toolArgsByBlockId: new Map(),
    thinkingActive: false,
  };
}

/**
 * Strip Kimi inline citation chips embedded in answer text.
 * Runtime shape (Connect+JSON block.text): \uE3A0article🛠web_search:N#M…\uE3A8
 */
export function sanitizeKimiAnswerText(text: string): string {
  if (!text) return text;
  let out = text.replace(/\uE3A0[\s\S]*?\uE3A8/g, "");
  // Orphan hammer + ref tokens if delimiters were split across chunks
  out = out.replace(/\u{1F6E0}web_search:\d+#\d+/gu, "");
  out = out.replace(/\uE3A0|\uE3A8/g, "");
  return out;
}

/**
 * Kimi.com Connect+JSON (real capture / Bridge-compatible):
 * - mask chat.lastRequest / heartbeat → ignore
 * - mask message role=user → ignore; assistant status completed → finish
 * - block.multiStage / block.stage with STAGE_NAME_THINKING → reasoning channel
 * - delta.content / block.text.content → route by thinking block parent chain
 * - block.stage/block.search search payloads → Tools web_search
 */
export function pushKimiWeb(
  state: KimiWebMergeState,
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): void {
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
    if (blockId) state.thinkingBlockIds.add(blockId);
  };

  const underThinking = (parentId?: string, blockId?: string): boolean => {
    if (state.thinkingActive) return true;
    if (blockId && state.thinkingBlockIds.has(blockId)) return true;
    if (parentId && state.thinkingBlockIds.has(parentId)) return true;
    return false;
  };

  const pushText = (raw: string, channel: "content" | "reasoning") => {
    let text = raw;
    if (channel === "content") {
      text = sanitizeKimiAnswerText(text);
      // Do not seed Content tab with whitespace-only crumbs while thinking streams
      if (!text || (!state.content && /^\s*$/.test(text))) return;
    } else if (!text) {
      return;
    }
    state.chunkCount++;
    if (channel === "reasoning") state.reasoning += text;
    else state.content += text;
  };

  /** Push block.text — dedupe cumulative snapshots for thinking blocks. */
  const pushBlockText = (
    blockId: string | undefined,
    text: string,
    channel: "content" | "reasoning",
  ) => {
    if (!text) return;
    if (channel === "reasoning" && blockId) {
      const prev = state.blockTextSnapshots.get(blockId) ?? "";
      let delta = text;
      if (text.startsWith(prev)) {
        delta = text.slice(prev.length);
      } else if (prev.startsWith(text)) {
        return;
      }
      if (text.length >= prev.length) state.blockTextSnapshots.set(blockId, text);
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
      const seen = new Set(prevResults.map((r) => String(r.url || r.title || r.ref_index || "")));
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
      ? state.tools.find((t) => t.id === blockId && t.name === name)
      : undefined;
    if (existingById) {
      existingById.arguments = mergeArgs(existingById.arguments, queries, results);
      state.chunkCount++;
      return;
    }

    if (name === "web_search") {
      const orphan = state.tools.find((t) => t.name === "web_search");
      if (orphan) {
        if (blockId) orphan.id = blockId;
        orphan.arguments = mergeArgs(orphan.arguments, queries, results);
        state.chunkCount++;
        return;
      }
    }

    const payload = JSON.stringify({ type: "SEARCH", queries, results });
    state.tools.push({
      index: state.tools.length,
      id: blockId,
      name,
      arguments: payload,
    });
    state.chunkCount++;
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

    const toolBlockId = blockId ?? asString(toolBag.toolCallId) ?? asString(toolBag.tool_call_id);
    const name = asString(toolBag.name) ?? "web_search";

    const argsFragment = asString(toolBag.args);
    let queries: string[] = [];
    if (argsFragment && toolBlockId) {
      const prev = state.toolArgsByBlockId.get(toolBlockId) ?? "";
      const combined =
        argsFragment.startsWith("{") && argsFragment.endsWith("}")
          ? argsFragment
          : prev + argsFragment;
      state.toolArgsByBlockId.set(toolBlockId, combined);
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
      state.thinkingActive = !stageEnded(stage.status);
    } else if (isSearchStageName(name)) {
      if (isRecord(stage.search)) ingestSearchPayload(stage.search, blockId);
    } else if (stageEnded(stage.status) && parentId && state.thinkingBlockIds.has(parentId)) {
      state.thinkingActive = false;
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
      ingestSearchPayload(
        { results: stage.results, query: stage.query, queries: stage.queries },
        blockId,
      );
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
          state.thinkingActive = !stageEnded(stage.status);
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
      if (reason) state.endMeta.finishReason = reason;
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
      (blockRef ? (asString(blockRef.parentId) ?? asString(blockRef.parent_id)) : undefined) ??
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
          state.endMeta.finishReason = state.endMeta.finishReason ?? "stop";
        }
      }
      continue;
    }

    ingestDelta(parsed);

    if (isRecord(parsed.block)) {
      ingestBlock(parsed.block);
    }
  }
}

export function snapshotKimiWeb(state: KimiWebMergeState): MergeChannelsResult {
  return {
    channels: { content: state.content, reasoning: state.reasoning, tools: state.tools },
    endMeta: state.endMeta,
    chunkCount: state.chunkCount,
  };
}

export function mergeKimiWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): MergeChannelsResult {
  const s = createKimiWebMergeState();
  pushKimiWeb(s, events);
  return snapshotKimiWeb(s);
}
