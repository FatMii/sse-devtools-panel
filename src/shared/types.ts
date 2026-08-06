export const MESSAGE_SOURCE = "eventstream" as const;

/** chrome.runtime Port name between DevTools panel and service worker. */
export const PANEL_PORT = "eventstream-panel" as const;

export type StreamStatus = "streaming" | "done" | "error";

/** How the page opened the streaming request. */
export type StreamTransport = "fetch" | "eventsource" | "xhr";

/** Wire format of the response body. */
export type StreamKind = "sse" | "ndjson" | "connect-json";

/** Why a stream stopped (or completed). */
export type StreamCloseReason = "complete" | "abort" | "error" | "http_error";

/** One EventSource reconnect attempt (browser auto-retry). */
export interface StreamReconnectMark {
  at: number;
  reconnectCount: number;
  lastEventId?: string;
}

export interface StreamStartPayload {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  contentType?: string;
  /** Redacted request headers collected from page world (best effort). */
  requestHeaders?: Record<string, string>;
  /** Redacted response headers (best effort). */
  responseHeaders?: Record<string, string>;
  /** Text preview of request payload (best effort, truncated). */
  requestPayloadPreview?: string;
  /** Whether payload preview was truncated. */
  requestPayloadTruncated?: boolean;
  transport: StreamTransport;
  streamKind: StreamKind;
  startedAt: number;
}

export interface StreamChunkPayload {
  requestId: string;
  text: string;
}

export interface StreamEndPayload {
  requestId: string;
  endedAt: number;
  closeReason?: Extract<StreamCloseReason, "complete" | "abort">;
}

export interface StreamErrorPayload {
  requestId: string;
  message: string;
  endedAt: number;
  closeReason?: Extract<StreamCloseReason, "abort" | "error" | "http_error">;
}

export interface StreamReconnectPayload {
  requestId: string;
  at: number;
  /** 1-based count of reconnect attempts for this EventSource. */
  reconnectCount: number;
  lastEventId?: string;
}

export interface StreamDiscardPayload {
  requestId: string;
}

export type PageToExtensionMessage =
  | { source: typeof MESSAGE_SOURCE; type: "stream-start"; payload: StreamStartPayload }
  | { source: typeof MESSAGE_SOURCE; type: "stream-chunk"; payload: StreamChunkPayload }
  | { source: typeof MESSAGE_SOURCE; type: "stream-end"; payload: StreamEndPayload }
  | { source: typeof MESSAGE_SOURCE; type: "stream-error"; payload: StreamErrorPayload }
  | { source: typeof MESSAGE_SOURCE; type: "stream-reconnect"; payload: StreamReconnectPayload }
  | { source: typeof MESSAGE_SOURCE; type: "stream-discard"; payload: StreamDiscardPayload };

export type RelayMessage = PageToExtensionMessage & {
  tabId: number;
};

export interface SseEvent {
  id?: string;
  event: string;
  data: string;
  retry?: number;
  raw: string;
  index: number;
  /** Client receive time (ms since epoch) */
  receivedAt: number;
}

export interface StreamMetrics {
  ttftMs?: number;
  durationMs?: number;
  avgGapMs?: number;
  p95GapMs?: number;
  eventsPerSec?: number;
}

/** How this record entered the panel. */
export type StreamOrigin = "live" | "imported" | "archive";

export interface StreamRecord {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  contentType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestPayloadPreview?: string;
  requestPayloadTruncated?: boolean;
  transport: StreamTransport;
  streamKind: StreamKind;
  startedAt: number;
  endedAt?: number;
  streamStatus: StreamStatus;
  errorMessage?: string;
  closeReason?: StreamCloseReason;
  /** Latest SSE `id` / EventSource `lastEventId` observed. */
  lastEventId?: string;
  /** EventSource auto-reconnect attempts. */
  reconnectCount?: number;
  reconnects?: StreamReconnectMark[];
  raw: string;
  events: SseEvent[];
  metrics?: StreamMetrics;
  /** Present for imported / loaded-from-archive rows. */
  origin?: StreamOrigin;
}
