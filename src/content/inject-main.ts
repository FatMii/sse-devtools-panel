import { classifyHttpStatus, classifyThrownError } from "../shared/stream-close";
import {
  MESSAGE_SOURCE,
  type PageToExtensionMessage,
  type StreamChunkPayload,
  type StreamCloseReason,
  type StreamEndPayload,
  type StreamErrorPayload,
  type StreamKind,
  type StreamReconnectPayload,
  type StreamStartPayload,
  type StreamTransport,
} from "../shared/types";

const STATE_KEY = "__SSE_DEVTOOLS_INSTALLED__";

declare global {
  interface Window {
    [STATE_KEY]?: boolean;
  }
}

if (!window[STATE_KEY]) {
  window[STATE_KEY] = true;
  install();
}

type PostStart = (p: StreamStartPayload) => void;
type PostChunk = (p: StreamChunkPayload) => void;
type PostEnd = (p: StreamEndPayload) => void;
type PostError = (p: StreamErrorPayload) => void;
type PostReconnect = (p: StreamReconnectPayload) => void;
type PostDiscard = (requestId: string) => void;

function install(): void {
  let seq = 0;
  const nextId = () => `sse-${Date.now()}-${++seq}`;

  const post = (msg: PageToExtensionMessage): void => {
    window.postMessage(msg, "*");
  };

  const postStart: PostStart = (payload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-start", payload });
  const postChunk: PostChunk = (payload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-chunk", payload });
  const postEnd: PostEnd = (payload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-end", payload });
  const postError: PostError = (payload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-error", payload });
  const postReconnect: PostReconnect = (payload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-reconnect", payload });
  const postDiscard: PostDiscard = (requestId) =>
    post({ source: MESSAGE_SOURCE, type: "stream-discard", payload: { requestId } });

  patchFetch(nextId, postStart, postChunk, postEnd, postError, postDiscard);
  patchEventSource(nextId, postStart, postChunk, postEnd, postError, postReconnect);
  patchXhr(nextId, postStart, postChunk, postEnd, postError);
}

/** Decide whether a response Content-Type is a stream we care about. */
function detectStreamKind(contentType: string | null | undefined): StreamKind | null {
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
function looksLikeKimiConnectUrl(url: string): boolean {
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

function requestLooksLikeConnectJson(headers?: Record<string, string>): boolean {
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

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL) && input.method) {
    return input.method.toUpperCase();
  }
  return "GET";
}

const SENSITIVE_HEADER_RE =
  /^(authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|proxy-authorization)$/i;
/** Align closer to Network panel usable payload size (still capped for extension memory). */
const MAX_PAYLOAD_PREVIEW = 256_000;

function redactHeaderValue(name: string, value: string): string {
  if (SENSITIVE_HEADER_RE.test(name)) return "[REDACTED]";
  return value;
}

function normalizeHeaders(input?: HeadersInit): Record<string, string> | undefined {
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

function normalizeResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = redactHeaderValue(key, value);
  });
  return out;
}

function parseRawResponseHeaders(raw: string): Record<string, string> {
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

function mergeHeaderMaps(
  a?: Record<string, string>,
  b?: Record<string, string>,
): Record<string, string> | undefined {
  if (!a && !b) return undefined;
  if (!a) return { ...b };
  if (!b) return { ...a };
  return { ...a, ...b };
}

function clipPayloadText(
  text: string,
): { preview: string; truncated: boolean } {
  if (text.length <= MAX_PAYLOAD_PREVIEW) {
    return { preview: text, truncated: false };
  }
  return {
    preview: text.slice(0, MAX_PAYLOAD_PREVIEW),
    truncated: true,
  };
}

async function payloadPreviewFromBody(
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

async function collectFetchRequestMeta(
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

async function pumpReadableStream(
  body: ReadableStream<Uint8Array>,
  sink: {
    onBytes: (chunk: Uint8Array) => void;
    onComplete: () => void;
    onError: (message: string, closeReason?: Extract<StreamCloseReason, "abort" | "error">) => void;
  },
): Promise<void> {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        sink.onBytes(value);
      }
    }
    sink.onComplete();
  } catch (err) {
    const classified = classifyThrownError(err);
    sink.onError(classified.message, classified.closeReason);
  }
}

function createFetchTextSink(
  requestId: string,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
): {
  onBytes: (chunk: Uint8Array) => void;
  onComplete: () => void;
  onError: (message: string, closeReason?: Extract<StreamCloseReason, "abort" | "error">) => void;
} {
  const decoder = new TextDecoder();
  let closed = false;

  const flushText = (chunk: Uint8Array | undefined, stream: boolean): void => {
    const text = chunk ? decoder.decode(chunk, { stream }) : decoder.decode();
    if (text) {
      postChunk({ requestId, text });
    }
  };

  return {
    onBytes: (chunk) => {
      if (closed) return;
      flushText(chunk, true);
    },
    onComplete: () => {
      if (closed) return;
      closed = true;
      flushText(undefined, false);
      postEnd({ requestId, endedAt: Date.now(), closeReason: "complete" });
    },
    onError: (message, closeReason = "error") => {
      if (closed) return;
      closed = true;
      flushText(undefined, false);
      postError({ requestId, message, endedAt: Date.now(), closeReason });
    },
  };
}

/**
 * Connect+JSON: split binary frames in the page world, post each JSON payload as text.
 * (Panel ConnectJsonParser then turns each object into an event.)
 */
function createConnectJsonSink(
  requestId: string,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
): {
  onBytes: (chunk: Uint8Array) => void;
  onComplete: () => void;
  onError: (message: string, closeReason?: Extract<StreamCloseReason, "abort" | "error">) => void;
} {
  // Inline framer — inject bundle must stay self-contained (no shared import tree).
  const MAX_FRAME = 16 * 1024 * 1024;
  let buffer = new Uint8Array(0);
  let closed = false;
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const emitFrames = (chunk: Uint8Array): void => {
    if (chunk.byteLength === 0) return;
    const merged = new Uint8Array(buffer.length + chunk.byteLength);
    merged.set(buffer, 0);
    merged.set(chunk, buffer.length);
    buffer = merged;

    let offset = 0;
    while (buffer.length - offset >= 5) {
      const flags = buffer[offset]!;
      const length =
        ((buffer[offset + 1]! << 24) |
          (buffer[offset + 2]! << 16) |
          (buffer[offset + 3]! << 8) |
          buffer[offset + 4]!) >>>
        0;
      if (length > MAX_FRAME) {
        offset += 1;
        continue;
      }
      if (buffer.length - offset < 5 + length) break;
      const payload = buffer.subarray(offset + 5, offset + 5 + length);
      offset += 5 + length;
      // flag & 0x02 = end-stream / trailer; flag & 0x01 = compressed
      if ((flags & 0x02) !== 0 || (flags & 0x01) !== 0) continue;
      const jsonText = decoder.decode(payload).trim();
      if (jsonText) postChunk({ requestId, text: jsonText });
    }
    buffer = buffer.subarray(offset);
  };

  return {
    onBytes: (chunk) => {
      if (closed) return;
      emitFrames(chunk);
    },
    onComplete: () => {
      if (closed) return;
      closed = true;
      buffer = new Uint8Array(0);
      postEnd({ requestId, endedAt: Date.now(), closeReason: "complete" });
    },
    onError: (message, closeReason = "error") => {
      if (closed) return;
      closed = true;
      buffer = new Uint8Array(0);
      postError({ requestId, message, endedAt: Date.now(), closeReason });
    },
  };
}

/**
 * Observe bytes as the page consumes the body (instance-level reader wrap only).
 * Avoids tee()/new Response(), which can disturb some app stream consumers.
 */
function observeStreamReads(
  stream: ReadableStream<Uint8Array>,
  sink: {
    onBytes: (chunk: Uint8Array) => void;
    onComplete: () => void;
    onError: (message: string, closeReason?: Extract<StreamCloseReason, "abort" | "error">) => void;
  },
): void {
  const originalGetReader = stream.getReader.bind(stream);

  const wrapReader = <R extends ReadableStreamDefaultReader<Uint8Array> | ReadableStreamBYOBReader>(
    reader: R,
  ): R => {
    const originalRead = reader.read.bind(reader) as ReadableStreamDefaultReader<Uint8Array>["read"];
    const originalCancel = reader.cancel.bind(reader);

    (reader as ReadableStreamDefaultReader<Uint8Array>).read = (async (
      ...readArgs: Parameters<ReadableStreamDefaultReader<Uint8Array>["read"]>
    ) => {
      try {
        const result = await originalRead(...readArgs);
        if (result.done) {
          sink.onComplete();
        } else if ("value" in result && result.value) {
          const value = result.value as unknown;
          if (value instanceof Uint8Array) {
            sink.onBytes(value);
          } else if (ArrayBuffer.isView(value)) {
            const view = value as ArrayBufferView;
            sink.onBytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
          }
        }
        return result;
      } catch (err) {
        const classified = classifyThrownError(err);
        sink.onError(classified.message, classified.closeReason);
        throw err;
      }
    }) as ReadableStreamDefaultReader<Uint8Array>["read"];

    reader.cancel = (async (...cancelArgs: Parameters<ReadableStreamDefaultReader<Uint8Array>["cancel"]>) => {
      sink.onError("ReadableStream cancelled", "abort");
      return originalCancel(...cancelArgs);
    }) as ReadableStreamDefaultReader<Uint8Array>["cancel"];

    return reader;
  };

  Object.defineProperty(stream, "getReader", {
    configurable: true,
    writable: true,
    value: (...args: Parameters<ReadableStream<Uint8Array>["getReader"]>) => {
      const reader = originalGetReader(...(args as []));
      return wrapReader(reader as ReadableStreamDefaultReader<Uint8Array>);
    },
  });
}

/**
 * Capture fetch body bytes.
 * Prefer clone()+pump so we do not depend on the page starting to read.
 * Fall back to instance-level getReader observation on the page body.
 */
function captureFetchResponseBody(
  response: Response,
  sink: {
    onBytes: (chunk: Uint8Array) => void;
    onComplete: () => void;
    onError: (message: string, closeReason?: Extract<StreamCloseReason, "abort" | "error">) => void;
  },
): Response {
  if (!response.body) {
    sink.onComplete();
    return response;
  }

  try {
    const cloned = response.clone();
    if (cloned.body) {
      void pumpReadableStream(cloned.body, sink);
      return response;
    }
  } catch {
    // fall through to page-read observation
  }

  observeStreamReads(response.body, sink);

  try {
    const originalClone = response.clone.bind(response);
    Object.defineProperty(response, "clone", {
      configurable: true,
      writable: true,
      value: () => {
        const cloned = originalClone();
        if (cloned.body) {
          observeStreamReads(cloned.body, sink);
        }
        return cloned;
      },
    });
  } catch {
    // ignore
  }

  return response;
}

function patchFetch(
  nextId: () => string,
  postStart: PostStart,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
  _postDiscard: PostDiscard,
): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestId = nextId();
    const url = resolveUrl(input);
    const method = resolveMethod(input, init);
    const startedAt = Date.now();
    const reqMeta = await collectFetchRequestMeta(input, init);
    let announced = false;

    const announce = (extra: {
      status?: number;
      statusText?: string;
      contentType?: string;
      streamKind: StreamKind;
      url?: string;
      responseHeaders?: Record<string, string>;
    }): void => {
      postStart({
        requestId,
        url: extra.url ?? url,
        method,
        status: extra.status,
        statusText: extra.statusText,
        contentType: extra.contentType,
        requestHeaders: reqMeta.headers,
        responseHeaders: extra.responseHeaders,
        requestPayloadPreview: reqMeta.payloadPreview,
        requestPayloadTruncated: reqMeta.payloadTruncated,
        transport: "fetch",
        streamKind: extra.streamKind,
        startedAt,
      });
      announced = true;
    };

    const resolveFetchStreamKind = (contentType: string | null): StreamKind | null => {
      let streamKind = detectStreamKind(contentType);
      // Some gateways omit/mislabel CT; fall back to request Accept/Content-Type or host.
      if (!streamKind && requestLooksLikeConnectJson(reqMeta.headers)) {
        streamKind = "connect-json";
      }
      if (!streamKind && looksLikeKimiConnectUrl(url)) {
        streamKind = "connect-json";
      }
      return streamKind;
    };

    try {
      const response = await originalFetch(input, init);

      const contentType = response.headers.get("content-type");
      const streamKind = resolveFetchStreamKind(contentType);
      if (!streamKind) {
        return response;
      }

      announce({
        status: response.status,
        statusText: response.statusText || undefined,
        contentType: contentType ?? undefined,
        streamKind,
        url: response.url || url,
        responseHeaders: normalizeResponseHeaders(response.headers),
      });

      const sink =
        streamKind === "connect-json"
          ? createConnectJsonSink(requestId, postChunk, postEnd, postError)
          : createFetchTextSink(requestId, postChunk, postEnd, postError);
      return captureFetchResponseBody(response, sink);
    } catch (err) {
      if (announced) {
        const classified = classifyThrownError(err);
        postError({
          requestId,
          message: classified.message,
          endedAt: Date.now(),
          closeReason: classified.closeReason,
        });
      }
      throw err;
    }
  };
}

function toSseFrame(typeName: string, data: string, id?: string): string {
  const idLine = id ? `id: ${id}\n` : "";
  const eventLine = typeName !== "message" ? `event: ${typeName}\n` : "";
  const dataLines = data
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n");
  return `${idLine}${eventLine}${dataLines}\n\n`;
}

function patchEventSource(
  nextId: () => string,
  postStart: PostStart,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
  postReconnect: PostReconnect,
): void {
  const OriginalEventSource = window.EventSource;

  function PatchedEventSource(
    this: EventSource,
    url: string | URL,
    eventSourceInitDict?: EventSourceInit,
  ): EventSource {
    const instance = new OriginalEventSource(url, eventSourceInitDict);
    const requestId = nextId();
    const href = typeof url === "string" ? url : url.href;
    let ended = false;
    let clientClosed = false;
    let reconnectCount = 0;
    let lastEventId = "";

    postStart({
      requestId,
      url: href,
      method: "GET",
      contentType: "text/event-stream",
      transport: "eventsource",
      streamKind: "sse",
      startedAt: Date.now(),
    });

    const finish = (
      mode: "end" | "error",
      closeReason: StreamCloseReason,
      message?: string,
    ) => {
      if (ended) return;
      ended = true;
      const endedAt = Date.now();
      if (mode === "error") {
        postError({
          requestId,
          message: message || "EventSource error",
          endedAt,
          closeReason:
            closeReason === "abort" || closeReason === "http_error" ? closeReason : "error",
        });
      } else {
        postEnd({
          requestId,
          endedAt,
          closeReason: closeReason === "abort" ? "abort" : "complete",
        });
      }
    };

    const onMessage = (ev: Event) => {
      const me = ev as MessageEvent;
      const typeName = me.type && me.type !== "message" ? me.type : "message";
      const data = typeof me.data === "string" ? me.data : String(me.data ?? "");
      const eventId =
        typeof me.lastEventId === "string" && me.lastEventId ? me.lastEventId : undefined;
      if (eventId) lastEventId = eventId;
      postChunk({ requestId, text: toSseFrame(typeName, data, eventId) });
    };

    instance.addEventListener("message", onMessage);

    const trackedTypes = new Set<string>(["message"]);
    const originalAdd = instance.addEventListener.bind(instance);
    instance.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type !== "error" && type !== "open" && !trackedTypes.has(type)) {
        trackedTypes.add(type);
        originalAdd(type, onMessage);
      }
      return originalAdd(type, listener as EventListener, options);
    }) as typeof instance.addEventListener;

    instance.addEventListener("error", () => {
      if (ended) return;
      if (instance.readyState === OriginalEventSource.CLOSED) {
        if (clientClosed) {
          finish("error", "abort", "EventSource closed by client");
        } else {
          finish("error", "error", "EventSource connection closed");
        }
        return;
      }
      // CONNECTING — browser will auto-reconnect; keep the stream open.
      reconnectCount += 1;
      postReconnect({
        requestId,
        at: Date.now(),
        reconnectCount,
        lastEventId: lastEventId || undefined,
      });
    });

    const originalClose = instance.close.bind(instance);
    instance.close = (): void => {
      clientClosed = true;
      originalClose();
      finish("error", "abort", "EventSource closed by client");
    };

    return instance;
  }

  PatchedEventSource.prototype = OriginalEventSource.prototype;
  Object.defineProperty(PatchedEventSource, "CONNECTING", {
    value: OriginalEventSource.CONNECTING,
  });
  Object.defineProperty(PatchedEventSource, "OPEN", { value: OriginalEventSource.OPEN });
  Object.defineProperty(PatchedEventSource, "CLOSED", { value: OriginalEventSource.CLOSED });

  window.EventSource = PatchedEventSource as unknown as typeof EventSource;
}

/**
 * Capture incremental XHR text bodies for SSE / NDJSON responses.
 * Only observes readyState progression; does not alter request/response for the page.
 */
function patchXhr(
  nextId: () => string,
  postStart: PostStart,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
): void {
  const OriginalXHR = window.XMLHttpRequest;

  function PatchedXHR(this: XMLHttpRequest): XMLHttpRequest {
    const xhr = new OriginalXHR();
    let method = "GET";
    let url = "";
    const requestHeaders: Record<string, string> = {};
    let requestPayloadPreview: string | undefined;
    let requestPayloadTruncated: boolean | undefined;
    let requestId: string | null = null;
    let captured = false;
    let finished = false;
    let lastLen = 0;

    const originalOpen = xhr.open.bind(xhr);
    xhr.open = ((...args: Parameters<XMLHttpRequest["open"]>) => {
      method = String(args[0] ?? "GET").toUpperCase();
      url = String(args[1] ?? "");
      return originalOpen(...args);
    }) as XMLHttpRequest["open"];

    const originalSetRequestHeader = xhr.setRequestHeader.bind(xhr);
    xhr.setRequestHeader = ((name: string, value: string) => {
      requestHeaders[name.toLowerCase()] = redactHeaderValue(name, String(value));
      return originalSetRequestHeader(name, value);
    }) as XMLHttpRequest["setRequestHeader"];

    const originalSend = xhr.send.bind(xhr);
    xhr.send = ((body?: Document | XMLHttpRequestBodyInit | null) => {
      if (body == null) {
        requestPayloadPreview = undefined;
        requestPayloadTruncated = undefined;
      } else if (typeof body === "string") {
        const clipped = clipPayloadText(body);
        requestPayloadPreview = clipped.preview;
        requestPayloadTruncated = clipped.truncated;
      } else if (body instanceof URLSearchParams) {
        const clipped = clipPayloadText(body.toString());
        requestPayloadPreview = clipped.preview;
        requestPayloadTruncated = clipped.truncated;
      } else if (body instanceof FormData) {
        const fields: string[] = [];
        body.forEach((value, key) => {
          if (typeof value === "string") fields.push(`${key}=${value}`);
          else fields.push(`${key}=[blob:${value.type || "application/octet-stream"}]`);
        });
        const clipped = clipPayloadText(fields.join("&"));
        requestPayloadPreview = clipped.preview;
        requestPayloadTruncated = clipped.truncated;
      } else if (body instanceof Blob) {
        requestPayloadPreview = `[blob:${body.type || "application/octet-stream"}]`;
        requestPayloadTruncated = false;
      } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        const bytes = body.byteLength;
        requestPayloadPreview = `[binary:${bytes} bytes]`;
        requestPayloadTruncated = false;
      } else if (typeof Document !== "undefined" && body instanceof Document) {
        requestPayloadPreview = "[document]";
        requestPayloadTruncated = false;
      } else {
        requestPayloadPreview = "[payload]";
        requestPayloadTruncated = false;
      }
      return originalSend(body);
    }) as XMLHttpRequest["send"];

    const tryStart = (): void => {
      if (captured || finished) return;
      if (xhr.readyState < OriginalXHR.HEADERS_RECEIVED) return;

      let contentType = "";
      try {
        contentType = xhr.getResponseHeader("content-type") ?? "";
      } catch {
        return;
      }

      const kind = detectStreamKind(contentType);
      // Connect+JSON is binary length-prefixed — XHR responseText corrupts frames.
      if (!kind || kind === "connect-json") return;

      captured = true;
      requestId = nextId();
      lastLen = 0;

      let responseHeaders: Record<string, string> | undefined;
      let statusText: string | undefined;
      try {
        const raw = xhr.getAllResponseHeaders();
        if (raw) responseHeaders = parseRawResponseHeaders(raw);
      } catch {
        // ignore
      }
      try {
        statusText = xhr.statusText || undefined;
      } catch {
        // ignore
      }

      postStart({
        requestId,
        url,
        method,
        status: xhr.status || undefined,
        statusText,
        contentType: contentType || undefined,
        requestHeaders: Object.keys(requestHeaders).length > 0 ? { ...requestHeaders } : undefined,
        responseHeaders:
          responseHeaders && Object.keys(responseHeaders).length > 0 ? responseHeaders : undefined,
        requestPayloadPreview,
        requestPayloadTruncated,
        transport: "xhr" satisfies StreamTransport,
        streamKind: kind,
        startedAt: Date.now(),
      });
    };

    const emitDelta = (): void => {
      if (!captured || !requestId || finished) return;
      // responseText is only available for default / text responseType
      if (xhr.responseType && xhr.responseType !== "text") {
        return;
      }
      try {
        const text = xhr.responseText ?? "";
        if (text.length > lastLen) {
          const delta = text.slice(lastLen);
          lastLen = text.length;
          if (delta) {
            postChunk({ requestId, text: delta });
          }
        }
      } catch {
        // Ignore if responseText is inaccessible mid-flight
      }
    };

    const finishOk = (): void => {
      if (!captured || !requestId || finished) return;
      finished = true;
      emitDelta();
      postEnd({ requestId, endedAt: Date.now(), closeReason: "complete" });
    };

    const finishErr = (
      message: string,
      closeReason: Extract<StreamCloseReason, "abort" | "error" | "http_error">,
    ): void => {
      if (!captured || !requestId || finished) return;
      finished = true;
      emitDelta();
      postError({ requestId, message, endedAt: Date.now(), closeReason });
    };

    xhr.addEventListener("readystatechange", () => {
      tryStart();
      if (xhr.readyState === OriginalXHR.LOADING || xhr.readyState === OriginalXHR.DONE) {
        emitDelta();
      }
      if (xhr.readyState === OriginalXHR.DONE && captured) {
        if (xhr.status >= 400) {
          const classified = classifyHttpStatus(xhr.status);
          finishErr(classified.message, classified.closeReason);
        } else {
          finishOk();
        }
      }
    });

    xhr.addEventListener("error", () => {
      if (captured) {
        finishErr("XMLHttpRequest network error", "error");
      }
    });

    xhr.addEventListener("abort", () => {
      if (captured) {
        finishErr("XMLHttpRequest aborted", "abort");
      }
    });

    return xhr;
  }

  PatchedXHR.prototype = OriginalXHR.prototype;
  Object.defineProperties(PatchedXHR, {
    UNSENT: { value: OriginalXHR.UNSENT },
    OPENED: { value: OriginalXHR.OPENED },
    HEADERS_RECEIVED: { value: OriginalXHR.HEADERS_RECEIVED },
    LOADING: { value: OriginalXHR.LOADING },
    DONE: { value: OriginalXHR.DONE },
  });

  window.XMLHttpRequest = PatchedXHR as unknown as typeof XMLHttpRequest;
}
