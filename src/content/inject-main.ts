import {
  MESSAGE_SOURCE,
  type PageToExtensionMessage,
  type StreamChunkPayload,
  type StreamEndPayload,
  type StreamErrorPayload,
  type StreamStartPayload,
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

function install(): void {
  let seq = 0;
  const nextId = () => `sse-${Date.now()}-${++seq}`;

  const post = (msg: PageToExtensionMessage): void => {
    window.postMessage(msg, "*");
  };

  const postStart = (payload: StreamStartPayload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-start", payload });
  const postChunk = (payload: StreamChunkPayload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-chunk", payload });
  const postEnd = (payload: StreamEndPayload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-end", payload });
  const postError = (payload: StreamErrorPayload) =>
    post({ source: MESSAGE_SOURCE, type: "stream-error", payload });

  patchFetch(nextId, postStart, postChunk, postEnd, postError);
  patchEventSource(nextId, postStart, postChunk, postEnd, postError);
}

function isEventStreamContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes("text/event-stream");
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
  postChunk: (p: StreamChunkPayload) => void,
  postEnd: (p: StreamEndPayload) => void,
  postError: (p: StreamErrorPayload) => void,
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
  postStart: (p: StreamStartPayload) => void,
  postChunk: (p: StreamChunkPayload) => void,
  postEnd: (p: StreamEndPayload) => void,
  postError: (p: StreamErrorPayload) => void,
): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);

    if (!isEventStreamContentType(response.headers.get("content-type"))) {
      return response;
    }

    const requestId = nextId();
    postStart({
      requestId,
      url: resolveUrl(input),
      method: resolveMethod(input, init),
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
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
  postStart: (p: StreamStartPayload) => void,
  postChunk: (p: StreamChunkPayload) => void,
  postEnd: (p: StreamEndPayload) => void,
  postError: (p: StreamErrorPayload) => void,
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

    // Proxy addEventListener so named SSE events are also captured once
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
