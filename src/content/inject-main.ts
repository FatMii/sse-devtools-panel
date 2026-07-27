import {
  MESSAGE_SOURCE,
  type PageToExtensionMessage,
  type StreamChunkPayload,
  type StreamEndPayload,
  type StreamErrorPayload,
  type StreamKind,
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

  patchFetch(nextId, postStart, postChunk, postEnd, postError);
  patchEventSource(nextId, postStart, postChunk, postEnd, postError);
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
  return null;
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

async function readStreamBody(
  body: ReadableStream<Uint8Array> | null,
  requestId: string,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
): Promise<void> {
  if (!body) {
    postEnd({ requestId, endedAt: Date.now() });
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) {
        postChunk({ requestId, text });
      }
    }
    const tail = decoder.decode();
    if (tail) {
      postChunk({ requestId, text: tail });
    }
    postEnd({ requestId, endedAt: Date.now() });
  } catch (err) {
    postError({
      requestId,
      message: err instanceof Error ? err.message : String(err),
      endedAt: Date.now(),
    });
  }
}

function patchFetch(
  nextId: () => string,
  postStart: PostStart,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);
    const contentType = response.headers.get("content-type");
    const streamKind = detectStreamKind(contentType);
    if (!streamKind) {
      return response;
    }

    const requestId = nextId();
    postStart({
      requestId,
      url: resolveUrl(input),
      method: resolveMethod(input, init),
      status: response.status,
      contentType: contentType ?? undefined,
      transport: "fetch",
      streamKind,
      startedAt: Date.now(),
    });

    const cloned = response.clone();
    void readStreamBody(cloned.body, requestId, postChunk, postEnd, postError);

    return response;
  };
}

function toSseFrame(typeName: string, data: string): string {
  const eventLine = typeName !== "message" ? `event: ${typeName}\n` : "";
  const dataLines = data
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n");
  return `${eventLine}${dataLines}\n\n`;
}

function patchEventSource(
  nextId: () => string,
  postStart: PostStart,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
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

    postStart({
      requestId,
      url: href,
      method: "GET",
      contentType: "text/event-stream",
      transport: "eventsource",
      streamKind: "sse",
      startedAt: Date.now(),
    });

    const finish = (error?: string) => {
      if (ended) return;
      ended = true;
      if (error) {
        postError({ requestId, message: error, endedAt: Date.now() });
      } else {
        postEnd({ requestId, endedAt: Date.now() });
      }
    };

    const onMessage = (ev: Event) => {
      const me = ev as MessageEvent;
      const typeName = me.type && me.type !== "message" ? me.type : "message";
      const data = typeof me.data === "string" ? me.data : String(me.data ?? "");
      postChunk({ requestId, text: toSseFrame(typeName, data) });
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
      if (instance.readyState === OriginalEventSource.CLOSED) {
        finish();
      } else {
        finish("EventSource error");
      }
    });

    const originalClose = instance.close.bind(instance);
    instance.close = (): void => {
      originalClose();
      finish();
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
    let requestId: string | null = null;
    let streamKind: StreamKind | null = null;
    let captured = false;
    let finished = false;
    let lastLen = 0;

    const originalOpen = xhr.open.bind(xhr);
    xhr.open = ((...args: Parameters<XMLHttpRequest["open"]>) => {
      method = String(args[0] ?? "GET").toUpperCase();
      url = String(args[1] ?? "");
      return originalOpen(...args);
    }) as XMLHttpRequest["open"];

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
      if (!kind) return;

      captured = true;
      streamKind = kind;
      requestId = nextId();
      lastLen = 0;

      postStart({
        requestId,
        url,
        method,
        status: xhr.status || undefined,
        contentType: contentType || undefined,
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
      postEnd({ requestId, endedAt: Date.now() });
    };

    const finishErr = (message: string): void => {
      if (!captured || !requestId || finished) return;
      finished = true;
      emitDelta();
      postError({ requestId, message, endedAt: Date.now() });
    };

    xhr.addEventListener("readystatechange", () => {
      tryStart();
      if (xhr.readyState === OriginalXHR.LOADING || xhr.readyState === OriginalXHR.DONE) {
        emitDelta();
      }
      if (xhr.readyState === OriginalXHR.DONE && captured) {
        if (xhr.status >= 400) {
          finishErr(`HTTP ${xhr.status}`);
        } else {
          finishOk();
        }
      }
    });

    xhr.addEventListener("error", () => {
      if (captured) {
        finishErr("XMLHttpRequest network error");
      }
    });

    xhr.addEventListener("abort", () => {
      if (captured) {
        finishErr("XMLHttpRequest aborted");
      }
    });

    // Silence unused warning for streamKind in edge tooling
    void streamKind;

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
