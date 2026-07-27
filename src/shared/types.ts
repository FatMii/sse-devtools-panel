export const MESSAGE_SOURCE = "sse-devtools" as const;

export type StreamStatus = "streaming" | "done" | "error";

/** How the page opened the streaming request. */
export type StreamTransport = "fetch" | "eventsource" | "xhr";

/** Wire format of the response body. */
export type StreamKind = "sse" | "ndjson";

export interface StreamStartPayload {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  contentType?: string;
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
}

export interface StreamErrorPayload {
  requestId: string;
  message: string;
  endedAt: number;
}

export type PageToExtensionMessage =
  | { source: typeof MESSAGE_SOURCE; type: "stream-start"; payload: StreamStartPayload }
  | { source: typeof MESSAGE_SOURCE; type: "stream-chunk"; payload: StreamChunkPayload }
  | { source: typeof MESSAGE_SOURCE; type: "stream-end"; payload: StreamEndPayload }
  | { source: typeof MESSAGE_SOURCE; type: "stream-error"; payload: StreamErrorPayload };

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

export interface StreamRecord {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  contentType?: string;
  transport: StreamTransport;
  streamKind: StreamKind;
  startedAt: number;
  endedAt?: number;
  streamStatus: StreamStatus;
  errorMessage?: string;
  raw: string;
  events: SseEvent[];
}
