import type { StreamCloseReason } from "../../shared/types";
import type { PostChunk, PostEnd, PostError, PostReconnect, PostStart } from "./types";

export function toSseFrame(typeName: string, data: string, id?: string): string {
  const idLine = id ? `id: ${id}\n` : "";
  const eventLine = typeName !== "message" ? `event: ${typeName}\n` : "";
  const dataLines = data
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n");
  return `${idLine}${eventLine}${dataLines}\n\n`;
}

/** `onping` → `ping`; ignores non-handler property names. */
export function eventTypeFromOnProperty(prop: string): string | null {
  if (!prop.startsWith("on") || prop.length <= 2) return null;
  return prop.slice(2);
}

export function patchEventSource(
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

    const finish = (mode: "end" | "error", closeReason: StreamCloseReason, message?: string) => {
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

    const trackedTypes = new Set<string>(["message"]);
    const originalAdd = instance.addEventListener.bind(instance);

    const trackType = (type: string): void => {
      if (!type || type === "error" || type === "open") return;
      if (trackedTypes.has(type)) return;
      trackedTypes.add(type);
      originalAdd(type, onMessage);
    };

    originalAdd("message", onMessage);

    instance.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      trackType(type);
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

    // Legacy / convenience handlers: `es.onping = fn` (in addition to addEventListener).
    return new Proxy(instance, {
      set(target, prop, value, receiver) {
        if (typeof prop === "string") {
          const type = eventTypeFromOnProperty(prop);
          if (type) trackType(type);
        }
        return Reflect.set(target, prop, value, receiver);
      },
    });
  }

  PatchedEventSource.prototype = OriginalEventSource.prototype;
  Object.defineProperty(PatchedEventSource, "CONNECTING", {
    value: OriginalEventSource.CONNECTING,
  });
  Object.defineProperty(PatchedEventSource, "OPEN", { value: OriginalEventSource.OPEN });
  Object.defineProperty(PatchedEventSource, "CLOSED", { value: OriginalEventSource.CLOSED });

  window.EventSource = PatchedEventSource as unknown as typeof EventSource;
}
