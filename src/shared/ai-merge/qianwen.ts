import type { SseEvent } from "../types";
import type { AiEndMeta, AiToolCall, MergeChannelsResult } from "./types";
import { asString, isRecord, parseEventData } from "./helpers";

/**
 * Qianwen plan_cot often ships newline-separated cumulative lines where each line
 * restates the full thought so far. Collapse those runs to the last line only.
 */
export function collapseCumulativeLines(text: string): string {
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
export function mergeQianwenWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): MergeChannelsResult {
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

  const upsertWebSearch = (queries: string[], results: Array<Record<string, unknown>>): void => {
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
      const seen = new Set(prevResults.map((r) => String(r.url || r.title || r.ref_num || "")));
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
