import type { SseEvent } from "../types";
import type { AiEndMeta, AiToolCall, MergeChannelsResult } from "./types";
import { asString, isRecord, parseEventData } from "./helpers";

/**
 * Tencent Yuanbao (元宝) web SSE:
 * - type=deepSearch contents[].text.msg → reasoning (delta per componentId)
 * - type=deepSearch contents[].toolCall.docs → web_search results
 * - type=step toolCallType=web_search → optional query label
 * - type=searchGuid.docs → web_search results (richer quotes)
 * - type=text.msg → content (delta)
 * - type=meta.stopReason → endMeta
 */
export function mergeYuanbaoWeb(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): MergeChannelsResult {
  const thinkByComponent = new Map<string, string>();
  const thinkComponentOrder: string[] = [];
  let content = "";
  const tools: AiToolCall[] = [];
  let chunkCount = 0;
  const endMeta: AiEndMeta = {};

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
      const seen = new Set(prevResults.map((r) => String(r.url || r.title || r.cite_index || "")));
      const mergedResults = [...prevResults];
      for (const r of nextResults) {
        const key = String(r.url || r.title || r.cite_index || "");
        if (key && seen.has(key)) {
          // Prefer richer later payloads (searchGuid over bare toolCall docs).
          const idx = mergedResults.findIndex(
            (x) => String(x.url || x.title || x.cite_index || "") === key,
          );
          if (idx >= 0) {
            mergedResults[idx] = { ...mergedResults[idx], ...r };
          }
          continue;
        }
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

  const normalizeDoc = (raw: unknown): Record<string, unknown> | null => {
    if (!isRecord(raw)) return null;
    const url = asString(raw.url) ?? asString(raw.link);
    const title = asString(raw.title) ?? asString(raw.name);
    if (!url && !title) return null;
    return {
      title,
      url,
      snippet: asString(raw.quote) ?? asString(raw.snippet) ?? asString(raw.summary),
      site_name:
        asString(raw.web_site_name) ??
        asString(raw.webSiteSource) ??
        asString(raw.sourceType) ??
        asString(raw.source),
      cite_index: raw.index ?? raw.cite_index ?? raw.ref_num,
      favicon: asString(raw.icon_url) ?? asString(raw.favicon),
      doc_id: asString(raw.docId),
    };
  };

  const extractDocs = (list: unknown): Array<Record<string, unknown>> => {
    if (!Array.isArray(list)) return [];
    const out: Array<Record<string, unknown>> = [];
    for (const item of list) {
      const n = normalizeDoc(item);
      if (n) out.push(n);
    }
    return out;
  };

  for (const ev of events) {
    const parsed = parseEventData(ev.data);
    if (!isRecord(parsed)) continue;

    const typ = asString(parsed.type) ?? "";

    if (typ === "deepSearch") {
      const contents = Array.isArray(parsed.contents) ? parsed.contents : [];
      for (const item of contents) {
        if (!isRecord(item)) continue;
        const itemType = asString(item.type) ?? "";
        if (itemType === "text") {
          const msg = asString(item.msg);
          if (!msg) continue;
          const id = String(item.componentId ?? "0");
          if (!thinkByComponent.has(id)) thinkComponentOrder.push(id);
          thinkByComponent.set(id, (thinkByComponent.get(id) ?? "") + msg);
          chunkCount++;
          continue;
        }
        if (itemType === "toolCall") {
          const docs = extractDocs(item.docs);
          if (docs.length > 0) upsertWebSearch([], docs);
        }
      }
      continue;
    }

    if (typ === "step") {
      // Status-only (e.g. 正在搜索资料); real sources arrive via toolCall/searchGuid docs.
      continue;
    }

    if (typ === "searchGuid") {
      const docs = extractDocs(parsed.docs);
      upsertWebSearch([], docs);
      continue;
    }

    if (typ === "text") {
      const msg = asString(parsed.msg);
      if (!msg) continue;
      content += msg;
      chunkCount++;
      continue;
    }

    if (typ === "meta") {
      const stop = asString(parsed.stopReason);
      if (stop) endMeta.finishReason = stop;
      const usage = parsed.tokenUsageInfo;
      if (isRecord(usage)) endMeta.usage = usage;
    }
  }

  const reasoning = thinkComponentOrder
    .map((id) => thinkByComponent.get(id) ?? "")
    .filter(Boolean)
    .join("");

  return {
    channels: {
      content,
      reasoning,
      tools,
    },
    endMeta,
    chunkCount,
  };
}
