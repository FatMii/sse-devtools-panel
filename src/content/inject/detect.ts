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

export function requestAcceptsEventStream(headers?: Record<string, string>): boolean {
  const accept = (headers?.accept ?? "").toLowerCase();
  return accept.includes("text/event-stream");
}

export function requestAcceptsNdjson(headers?: Record<string, string>): boolean {
  const accept = (headers?.accept ?? "").toLowerCase();
  return (
    accept.includes("application/x-ndjson") ||
    accept.includes("application/ndjson") ||
    accept.includes("application/jsonlines") ||
    accept.includes("application/json-lines") ||
    accept.includes("application/jsonl")
  );
}

/** `?stream=true` (common OpenAI-compatible query flag). */
export function urlLooksLikeStreamQuery(url: string): boolean {
  try {
    return new URL(url, "https://dummy.local").searchParams.get("stream") === "true";
  } catch {
    return /(?:^|[?&])stream=true(?:&|$)/i.test(url);
  }
}

/** JSON body preview contains `"stream": true`. */
export function payloadLooksLikeStreamTrue(preview?: string): boolean {
  if (!preview) return false;
  return /"stream"\s*:\s*true\b/.test(preview);
}

/**
 * Response CT that is often wrong/missing on streaming AI gateways.
 * Not treated as a stream by itself — only with request/url/body hints.
 */
export function isGenericOrMissingContentType(contentType: string | null | undefined): boolean {
  if (!contentType || !contentType.trim()) return true;
  const ct = contentType.toLowerCase();
  return (
    ct.includes("application/json") ||
    ct.includes("text/plain") ||
    ct.includes("application/octet-stream")
  );
}

export type ResolveStreamKindInput = {
  responseContentType?: string | null;
  requestHeaders?: Record<string, string>;
  url?: string;
  /** Truncated request body preview (fetch/XHR), if any. */
  requestPayloadPreview?: string;
};

/**
 * Resolve stream kind from response CT, then request/url/body heuristics.
 * Prefer false negatives over capturing every JSON API.
 */
export function resolveStreamKind(input: ResolveStreamKindInput): StreamKind | null {
  const fromCt = detectStreamKind(input.responseContentType);
  if (fromCt) return fromCt;

  if (requestLooksLikeConnectJson(input.requestHeaders)) return "connect-json";
  if (input.url && looksLikeKimiConnectUrl(input.url)) return "connect-json";

  if (requestAcceptsEventStream(input.requestHeaders)) return "sse";
  if (requestAcceptsNdjson(input.requestHeaders)) return "ndjson";

  const streamHint =
    (input.url ? urlLooksLikeStreamQuery(input.url) : false) ||
    payloadLooksLikeStreamTrue(input.requestPayloadPreview);

  if (streamHint && isGenericOrMissingContentType(input.responseContentType)) {
    // OpenAI-compatible streaming chat is almost always SSE-framed.
    return "sse";
  }

  return null;
}
