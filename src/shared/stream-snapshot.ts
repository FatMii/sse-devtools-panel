import type {
  SseEvent,
  StreamKind,
  StreamOrigin,
  StreamRecord,
  StreamStatus,
  StreamTransport,
} from "./types";

export const STREAM_EXPORT_FORMAT = "sse-devtools-stream-v1" as const;

export type { StreamOrigin };

export interface StreamExportPayload {
  format: typeof STREAM_EXPORT_FORMAT;
  exportedAt: number;
  stream: StreamExportBody;
}

export interface StreamExportBody {
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
  events: Array<{
    index: number;
    id?: string;
    event: string;
    data: string;
    retry?: number;
    receivedAt: number;
    raw: string;
  }>;
}

export function buildStreamExportPayload(record: StreamRecord): StreamExportPayload {
  return {
    format: STREAM_EXPORT_FORMAT,
    exportedAt: Date.now(),
    stream: {
      requestId: record.requestId,
      url: record.url,
      method: record.method,
      status: record.status,
      contentType: record.contentType,
      transport: record.transport,
      streamKind: record.streamKind,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      streamStatus: record.streamStatus,
      errorMessage: record.errorMessage,
      raw: record.raw,
      events: record.events.map((ev) => ({
        index: ev.index,
        id: ev.id,
        event: ev.event,
        data: ev.data,
        retry: ev.retry,
        receivedAt: ev.receivedAt,
        raw: ev.raw,
      })),
    },
  };
}

function isTransport(value: unknown): value is StreamTransport {
  return value === "fetch" || value === "eventsource" || value === "xhr";
}

function isStreamKind(value: unknown): value is StreamKind {
  return value === "sse" || value === "ndjson";
}

function isStreamStatus(value: unknown): value is StreamStatus {
  return value === "streaming" || value === "done" || value === "error";
}

function normalizeEvent(raw: unknown, fallbackIndex: number): SseEvent {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid event at index ${fallbackIndex}`);
  }
  const e = raw as Record<string, unknown>;
  const index = typeof e.index === "number" ? e.index : fallbackIndex;
  const event = typeof e.event === "string" && e.event ? e.event : "message";
  const data = typeof e.data === "string" ? e.data : "";
  const eventRaw = typeof e.raw === "string" ? e.raw : data;
  const receivedAt = typeof e.receivedAt === "number" ? e.receivedAt : Date.now();
  const out: SseEvent = {
    index,
    event,
    data,
    raw: eventRaw,
    receivedAt,
  };
  if (typeof e.id === "string") out.id = e.id;
  if (typeof e.retry === "number") out.retry = e.retry;
  return out;
}

function normalizeStreamBody(body: Record<string, unknown>): StreamExportBody {
  if (typeof body.url !== "string" || !body.url) {
    throw new Error("Missing stream.url");
  }
  if (typeof body.method !== "string" || !body.method) {
    throw new Error("Missing stream.method");
  }
  if (!isTransport(body.transport)) {
    throw new Error("Invalid stream.transport");
  }
  if (!isStreamKind(body.streamKind)) {
    throw new Error("Invalid stream.streamKind");
  }
  if (typeof body.startedAt !== "number") {
    throw new Error("Missing stream.startedAt");
  }
  if (!isStreamStatus(body.streamStatus)) {
    throw new Error("Invalid stream.streamStatus");
  }
  if (typeof body.raw !== "string") {
    throw new Error("Missing stream.raw");
  }
  if (!Array.isArray(body.events)) {
    throw new Error("Missing stream.events");
  }

  return {
    requestId: typeof body.requestId === "string" ? body.requestId : "unknown",
    url: body.url,
    method: body.method,
    status: typeof body.status === "number" ? body.status : undefined,
    contentType: typeof body.contentType === "string" ? body.contentType : undefined,
    transport: body.transport,
    streamKind: body.streamKind,
    startedAt: body.startedAt,
    endedAt: typeof body.endedAt === "number" ? body.endedAt : undefined,
    streamStatus: body.streamStatus === "streaming" ? "done" : body.streamStatus,
    errorMessage: typeof body.errorMessage === "string" ? body.errorMessage : undefined,
    raw: body.raw,
    events: body.events.map((ev, i) => normalizeEvent(ev, i)),
  };
}

/** Parse exported JSON text into a portable stream body. */
export function parseStreamExportJson(text: string): StreamExportBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Export root must be an object");
  }
  const root = parsed as Record<string, unknown>;

  if (root.format === STREAM_EXPORT_FORMAT && root.stream && typeof root.stream === "object") {
    return normalizeStreamBody(root.stream as Record<string, unknown>);
  }

  // Allow a bare stream object for convenience
  if (typeof root.url === "string" && Array.isArray(root.events)) {
    return normalizeStreamBody(root);
  }

  throw new Error(`Unsupported export format (expected ${STREAM_EXPORT_FORMAT})`);
}

export function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build an in-memory StreamRecord from a portable export body. */
export function streamRecordFromExport(
  body: StreamExportBody,
  options: { requestId: string; origin: StreamOrigin },
): StreamRecord {
  return {
    requestId: options.requestId,
    url: body.url,
    method: body.method,
    status: body.status,
    contentType: body.contentType,
    transport: body.transport,
    streamKind: body.streamKind,
    startedAt: body.startedAt,
    endedAt: body.endedAt,
    streamStatus: body.streamStatus === "streaming" ? "done" : body.streamStatus,
    errorMessage: body.errorMessage,
    raw: body.raw,
    events: body.events.map((ev) => ({ ...ev })),
    origin: options.origin,
  };
}

export function cloneStreamRecord(record: StreamRecord): StreamRecord {
  return {
    ...record,
    events: record.events.map((ev) => ({ ...ev })),
  };
}
