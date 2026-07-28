import type {
  SseEvent,
  StreamMetrics,
  StreamKind,
  StreamOrigin,
  StreamRecord,
  StreamStatus,
  StreamTransport,
} from "./types";
import { buildSseFixture } from "./sse-spec";

export { buildSseFixture };

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
  metrics?: StreamMetrics;
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
      statusText: record.statusText,
      contentType: record.contentType,
      requestHeaders: record.requestHeaders,
      responseHeaders: record.responseHeaders,
      requestPayloadPreview: record.requestPayloadPreview,
      requestPayloadTruncated: record.requestPayloadTruncated,
      transport: record.transport,
      streamKind: record.streamKind,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      streamStatus: record.streamStatus,
      errorMessage: record.errorMessage,
      metrics: record.metrics,
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

function normalizeMetrics(raw: unknown): StreamMetrics | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const out: StreamMetrics = {};
  if (typeof source.ttftMs === "number") out.ttftMs = source.ttftMs;
  if (typeof source.durationMs === "number") out.durationMs = source.durationMs;
  if (typeof source.avgGapMs === "number") out.avgGapMs = source.avgGapMs;
  if (typeof source.p95GapMs === "number") out.p95GapMs = source.p95GapMs;
  if (typeof source.eventsPerSec === "number") out.eventsPerSec = source.eventsPerSec;
  return Object.keys(out).length > 0 ? out : undefined;
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
    statusText: typeof body.statusText === "string" ? body.statusText : undefined,
    contentType: typeof body.contentType === "string" ? body.contentType : undefined,
    requestHeaders:
      body.requestHeaders && typeof body.requestHeaders === "object"
        ? Object.fromEntries(
            Object.entries(body.requestHeaders as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : undefined,
    responseHeaders:
      body.responseHeaders && typeof body.responseHeaders === "object"
        ? Object.fromEntries(
            Object.entries(body.responseHeaders as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : undefined,
    requestPayloadPreview:
      typeof body.requestPayloadPreview === "string" ? body.requestPayloadPreview : undefined,
    requestPayloadTruncated:
      typeof body.requestPayloadTruncated === "boolean" ? body.requestPayloadTruncated : undefined,
    transport: body.transport,
    streamKind: body.streamKind,
    startedAt: body.startedAt,
    endedAt: typeof body.endedAt === "number" ? body.endedAt : undefined,
    streamStatus: body.streamStatus === "streaming" ? "done" : body.streamStatus,
    errorMessage: typeof body.errorMessage === "string" ? body.errorMessage : undefined,
    metrics: normalizeMetrics(body.metrics),
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
    statusText: body.statusText,
    contentType: body.contentType,
    requestHeaders: body.requestHeaders ? { ...body.requestHeaders } : undefined,
    responseHeaders: body.responseHeaders ? { ...body.responseHeaders } : undefined,
    requestPayloadPreview: body.requestPayloadPreview,
    requestPayloadTruncated: body.requestPayloadTruncated,
    transport: body.transport,
    streamKind: body.streamKind,
    startedAt: body.startedAt,
    endedAt: body.endedAt,
    streamStatus: body.streamStatus === "streaming" ? "done" : body.streamStatus,
    errorMessage: body.errorMessage,
    metrics: body.metrics ? { ...body.metrics } : undefined,
    raw: body.raw,
    events: body.events.map((ev) => ({ ...ev })),
    origin: options.origin,
  };
}

export function cloneStreamRecord(record: StreamRecord): StreamRecord {
  return {
    ...record,
    metrics: record.metrics ? { ...record.metrics } : undefined,
    events: record.events.map((ev) => ({ ...ev })),
  };
}

/** Escape a CSV cell (RFC 4180-ish). */
export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatTimestampIso(ts: number): string {
  return new Date(ts).toISOString();
}

/**
 * Build a CSV snapshot of a stream.
 * Includes UTF-8 BOM for Excel. Optional `events` overrides which rows to export
 * (e.g. current Events search filter); defaults to all events on the record.
 */
export function buildStreamExportCsv(record: StreamRecord, events?: SseEvent[]): string {
  const rows = events ?? record.events;
  const headers = [
    "RequestId",
    "URL",
    "Method",
    "Status",
    "Transport",
    "StreamKind",
    "StreamStatus",
    "EventIndex",
    "EventId",
    "Event",
    "Data",
    "Retry",
    "ReceivedAt",
  ];

  const lines = rows.map((ev) =>
    [
      escapeCsvCell(record.requestId),
      escapeCsvCell(record.url),
      escapeCsvCell(record.method),
      escapeCsvCell(record.status),
      escapeCsvCell(record.transport),
      escapeCsvCell(record.streamKind),
      escapeCsvCell(record.streamStatus),
      escapeCsvCell(ev.index),
      escapeCsvCell(ev.id),
      escapeCsvCell(ev.event),
      escapeCsvCell(ev.data),
      escapeCsvCell(ev.retry),
      escapeCsvCell(formatTimestampIso(ev.receivedAt)),
    ].join(","),
  );

  // BOM helps Excel open UTF-8 correctly
  return `\uFEFF${[headers.join(","), ...lines].join("\r\n")}\r\n`;
}
