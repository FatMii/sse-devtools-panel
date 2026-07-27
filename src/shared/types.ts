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
  /** Redacted request headers collected from page world (best effort). */
  requestHeaders?: Record<string, string>;
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
}

export interface StreamErrorPayload {
  requestId: string;
  message: string;
  endedAt: number;
}

export interface StreamDiscardPayload {
  requestId: string;
}

export type PageToExtensionMessage =
  | { source: typeof MESSAGE_SOURCE; type: "stream-start"; payload: StreamStartPayload }
  | { source: typeof MESSAGE_SOURCE; type: "stream-chunk"; payload: StreamChunkPayload }
  | { source: typeof MESSAGE_SOURCE; type: "stream-end"; payload: StreamEndPayload }
  | { source: typeof MESSAGE_SOURCE; type: "stream-error"; payload: StreamErrorPayload }
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

export type AiProfile =
  | "openai-compatible"
  | "anthropic"
  | "deepseek"
  | "doubao"
  | "generic";

export interface StreamAiProfile {
  profile: AiProfile;
  confidence: number;
  reasons: string[];
}

/** How this record entered the panel. */
export type StreamOrigin = "live" | "imported" | "archive";

export interface StreamRecord {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  contentType?: string;
  requestHeaders?: Record<string, string>;
  requestPayloadPreview?: string;
  requestPayloadTruncated?: boolean;
  transport: StreamTransport;
  streamKind: StreamKind;
  startedAt: number;
  endedAt?: number;
  streamStatus: StreamStatus;
  errorMessage?: string;
  raw: string;
  events: SseEvent[];
  metrics?: StreamMetrics;
  aiProfile?: StreamAiProfile;
  transcript?: string;
  /** Present for imported / loaded-from-archive rows. */
  origin?: StreamOrigin;
}
