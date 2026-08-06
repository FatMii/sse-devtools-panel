export function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL) && input.method) {
    return input.method.toUpperCase();
  }
  return "GET";
}

export const SENSITIVE_HEADER_RE =
  /^(authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|proxy-authorization)$/i;
/** Max chars kept for request/response payload previews. */
export const MAX_PAYLOAD_PREVIEW = 256_000;

export function redactHeaderValue(name: string, value: string): string {
  if (SENSITIVE_HEADER_RE.test(name)) return "[REDACTED]";
  return value;
}

export function normalizeHeaders(input?: HeadersInit): Record<string, string> | undefined {
  if (!input) return undefined;
  const out: Record<string, string> = {};
  try {
    const headers = new Headers(input);
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = redactHeaderValue(key, value);
    });
  } catch {
    return undefined;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = redactHeaderValue(key, value);
  });
  return out;
}

export function parseRawResponseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const name = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (!name) continue;
    out[name.toLowerCase()] = redactHeaderValue(name, value);
  }
  return out;
}

export function mergeHeaderMaps(
  a?: Record<string, string>,
  b?: Record<string, string>,
): Record<string, string> | undefined {
  if (!a && !b) return undefined;
  if (!a) return { ...b };
  if (!b) return { ...a };
  return { ...a, ...b };
}

export function clipPayloadText(text: string): { preview: string; truncated: boolean } {
  if (text.length <= MAX_PAYLOAD_PREVIEW) {
    return { preview: text, truncated: false };
  }
  return {
    preview: text.slice(0, MAX_PAYLOAD_PREVIEW),
    truncated: true,
  };
}

export async function payloadPreviewFromBody(
  body: BodyInit | null | undefined,
): Promise<{ preview?: string; truncated?: boolean }> {
  if (body == null) return {};
  if (typeof body === "string") {
    const clipped = clipPayloadText(body);
    return { preview: clipped.preview, truncated: clipped.truncated };
  }
  if (body instanceof URLSearchParams) {
    const clipped = clipPayloadText(body.toString());
    return { preview: clipped.preview, truncated: clipped.truncated };
  }
  if (body instanceof FormData) {
    const fields: string[] = [];
    body.forEach((value, key) => {
      if (typeof value === "string") {
        fields.push(`${key}=${value}`);
      } else {
        fields.push(`${key}=[blob:${value.type || "application/octet-stream"}]`);
      }
    });
    const clipped = clipPayloadText(fields.join("&"));
    return { preview: clipped.preview, truncated: clipped.truncated };
  }
  if (body instanceof Blob) {
    try {
      const text = await body.text();
      const clipped = clipPayloadText(text);
      return { preview: clipped.preview, truncated: clipped.truncated };
    } catch {
      return { preview: `[blob:${body.type || "application/octet-stream"}]` };
    }
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const bytes = body.byteLength;
    return { preview: `[binary:${bytes} bytes]` };
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return { preview: "[stream body]" };
  }
  return { preview: "[payload]" };
}

export async function collectFetchRequestMeta(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{
  headers?: Record<string, string>;
  payloadPreview?: string;
  payloadTruncated?: boolean;
}> {
  let requestHeaders: Record<string, string> | undefined;
  let payloadPreview: string | undefined;
  let payloadTruncated: boolean | undefined;

  if (typeof input !== "string" && !(input instanceof URL) && input instanceof Request) {
    requestHeaders = mergeHeaderMaps(requestHeaders, normalizeHeaders(input.headers));
    const body = input.clone();
    try {
      const text = await body.text();
      if (text) {
        const clipped = clipPayloadText(text);
        payloadPreview = clipped.preview;
        payloadTruncated = clipped.truncated;
      }
    } catch {
      // best effort only
    }
  }

  requestHeaders = mergeHeaderMaps(requestHeaders, normalizeHeaders(init?.headers));
  if (init?.body != null) {
    const fromInit = await payloadPreviewFromBody(init.body);
    payloadPreview = fromInit.preview ?? payloadPreview;
    payloadTruncated = fromInit.truncated ?? payloadTruncated;
  }

  return { headers: requestHeaders, payloadPreview, payloadTruncated };
}
