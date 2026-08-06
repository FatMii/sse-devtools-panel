import type { SseEvent } from "../types";
import type { AiEndMeta, AiToolCall, MergeChannelsResult } from "./types";
import { asString, isRecord, parseEventData } from "./helpers";

/**
 * Doubao.com web SSE (real capture):
 * - block_type 10040 = thinking container (thinking_block)
 * - Child text_block with parent_id → thinking container = reasoning
 * - block_type 10025 = search_query_result_block → Tools (web_search)
 * - Top-level text_block (no thinking parent) = content
 * - CHUNK_DELTA continues the last text channel (reasoning or content)
 * - Ignore tts_content (patch_object 111) and user FULL_MSG_NOTIFY
 */
export function mergeDoubaoWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): MergeChannelsResult {
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
    const search =
      bag && isRecord(bag.search_query_result_block) ? bag.search_query_result_block : null;
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
