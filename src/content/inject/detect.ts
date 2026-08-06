import type { StreamKind } from "../../shared/types";

/** Decide whether a response Content-Type is a stream we care about. */
export function detectStreamKind(contentType: string | null | undefined): StreamKind | null {
  if (!contentType) return null;
  const ct = contentType.toLowerCase();
  if (ct.includes("text/event-stream")) return "sse";
  if (
    ct.includes("application/x-ndjson") ||
    ct.includes("application/ndjson") ||
    ct.includes("application/jsonlines") ||
    ct.includes("application/json-lines") ||
    ct.includes("application/jsonl")
  ) {
    return "ndjson";
  }
  // Connect RPC (Kimi web chat, etc.): binary length-prefixed JSON frames.
  if (ct.includes("application/connect+json") || ct.includes("application/connect-json")) {
    return "connect-json";
  }
  return null;
}

/** Kimi.com web uses Connect+JSON (not api.moonshot OpenAI SSE). */
export function looksLikeKimiConnectUrl(url: string): boolean {
  try {
    const host = new URL(url, "https://dummy.local").hostname.toLowerCase();
    if (host.includes("api.moonshot.")) return false;
    return (
      host.includes("kimi.com") ||
      host.includes("kimi.ai") ||
      host === "kimi.moonshot.cn" ||
      host.endsWith(".moonshot.cn")
    );
  } catch {
    return /kimi\.com|kimi\.ai/i.test(url);
  }
}

export function requestLooksLikeConnectJson(headers?: Record<string, string>): boolean {
  if (!headers) return false;
  const accept = (headers.accept ?? "").toLowerCase();
  const contentType = (headers["content-type"] ?? "").toLowerCase();
  return (
    accept.includes("application/connect+json") ||
    accept.includes("application/connect-json") ||
    contentType.includes("application/connect+json") ||
    contentType.includes("application/connect-json")
  );
}
