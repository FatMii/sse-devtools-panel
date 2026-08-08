import type { SseEvent } from "../types";
import type { AiEndMeta, AiToolCall, MergeChannelsResult } from "./types";
import { asString, isRecord, parseEventData } from "./helpers";

export type ChatglmWebMergeState = {
  thinkLatest: string;
  textLatest: string;
  tools: AiToolCall[];
  chunkCount: number;
  endMeta: AiEndMeta;
  seenGenericToolKeys: Set<string>;
};

export function createChatglmWebMergeState(): ChatglmWebMergeState {
  return {
    thinkLatest: "",
    textLatest: "",
    tools: [],
    chunkCount: 0,
    endMeta: {},
    seenGenericToolKeys: new Set(),
  };
}

/**
 * ChatGLM / Qingyan web SSE:
 * - parts[].content[] type=think —reasoning (cumulative snapshot)
 * - parts[].content[] type=text —content (cumulative snapshot)
 * - parts[].content[] type=tool_calls —tools (skip finish)
 * - top-level / part status finish —endMeta
 */
export function pushChatglmWeb(
  state: ChatglmWebMergeState,
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): void {
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
      // Do not use item.text here —ChatGLM search_results reuse "text" for HTML snippets.
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
    pushQueryList(parsed.search_query); // ChatGLM: {"search_query":[{"q":"..."}]}
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
      const seen = new Set(prevResults.map((r) => String(r.url || r.title || r.cite_index || "")));
      const mergedResults = [...prevResults];
      for (const r of nextResults) {
        const key = String(r.url || r.title || r.cite_index || "");
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        mergedResults.push(r);
      }
      return JSON.stringify({ type: "SEARCH", queries: mergedQueries, results: mergedResults });
    };

    const orphan = state.tools.find((t) => t.name === "web_search");
    if (orphan) {
      orphan.arguments = mergeArgs(orphan.arguments, queries, results);
      if (id && !orphan.id) orphan.id = id;
      state.chunkCount++;
      return;
    }

    state.tools.push({
      index: state.tools.length,
      id,
      name: "web_search",
      arguments: JSON.stringify({ type: "SEARCH", queries, results }),
    });
    state.chunkCount++;
  };

  const upsertGenericTool = (name: string, args: string, id?: string): void => {
    if (!name || name === "finish") return;
    if (isSearchToolName(name)) return;
    const key = `${name}:${args}`;
    if (state.seenGenericToolKeys.has(key)) return;
    state.seenGenericToolKeys.add(key);
    const existing = state.tools.find((t) => t.name === name && (!id || t.id === id));
    if (existing) {
      existing.arguments = args;
      state.chunkCount++;
      return;
    }
    state.tools.push({ index: state.tools.length, id, name, arguments: args });
    state.chunkCount++;
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
        item.arguments ?? (isRecord(item.function) ? item.function.arguments : undefined);
      const argsText = stringifyArgs(argsRaw);
      const id =
        asString(item.id) ?? (isRecord(item.function) ? asString(item.function.id) : undefined);

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
      state.endMeta.finishReason = state.endMeta.finishReason ?? "stop";
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
        state.endMeta.finishReason = state.endMeta.finishReason ?? "stop";
      }
      if (typeof part.model === "string" && !state.endMeta.model) {
        state.endMeta.model = part.model;
      }

      ingestMeta(part.meta_data);

      const contentItems = Array.isArray(part.content) ? part.content : [];
      for (const item of contentItems) {
        if (!isRecord(item)) continue;
        const typ = asString(item.type) ?? "";

        if (typ === "think") {
          const think = asString(item.think) ?? asString(item.text) ?? "";
          if (think && think.length >= state.thinkLatest.length) {
            state.thinkLatest = think;
            state.chunkCount++;
          }
          continue;
        }

        if (typ === "text") {
          const text = asString(item.text) ?? "";
          if (text && text.length >= state.textLatest.length) {
            state.textLatest = text;
            state.chunkCount++;
          }
          continue;
        }

        if (typ === "tool_calls") {
          ingestToolCalls(item.tool_calls);
          continue;
        }

        // ChatGLM echoes the search call again under tool_result; results live in meta.
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
}

export function snapshotChatglmWeb(state: ChatglmWebMergeState): MergeChannelsResult {
  return {
    channels: {
      content: state.textLatest,
      reasoning: state.thinkLatest,
      tools: state.tools,
    },
    endMeta: state.endMeta,
    chunkCount: state.chunkCount,
  };
}

export function mergeChatglmWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): MergeChannelsResult {
  const s = createChatglmWebMergeState();
  pushChatglmWeb(s, events);
  return snapshotChatglmWeb(s);
}
