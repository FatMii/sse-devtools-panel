import type { SseEvent, StreamRecord } from "./types";

/** Wire-format issues vs WHATWG Server-Sent Events field rules. */
export type SseSpecWarningKind = "unknown-field" | "invalid-retry" | "null-in-id" | "bom";

export interface SseSpecWarning {
  kind: SseSpecWarningKind;
  /** Event index; omitted for stream-level warnings (e.g. leading BOM). */
  eventIndex?: number;
  /** Extra detail: unknown field name, invalid retry token, etc. */
  detail?: string;
}

const KNOWN_FIELDS = new Set(["event", "data", "id", "retry"]);

/**
 * Lint one SSE event block (the text between blank-line separators, without the trailing blank).
 */
export function lintSseEventBlock(raw: string, eventIndex: number): SseSpecWarning[] {
  const warnings: SseSpecWarning[] = [];
  if (!raw) return warnings;

  let block = raw;
  if (block.charCodeAt(0) === 0xfeff) {
    warnings.push({ kind: "bom", eventIndex, detail: "U+FEFF" });
    block = block.slice(1);
  }

  const lines = block.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (!KNOWN_FIELDS.has(field)) {
      warnings.push({ kind: "unknown-field", eventIndex, detail: field || "(empty)" });
      continue;
    }

    if (field === "retry" && !/^\d+$/.test(value)) {
      warnings.push({ kind: "invalid-retry", eventIndex, detail: value || "(empty)" });
    }

    if (field === "id" && value.includes("\u0000")) {
      warnings.push({ kind: "null-in-id", eventIndex });
    }
  }

  return warnings;
}

/** Stream-level lint of the captured raw body (independent of parsed events). */
export function lintSseStreamRaw(raw: string): SseSpecWarning[] {
  if (raw.charCodeAt(0) === 0xfeff) {
    return [{ kind: "bom", detail: "U+FEFF" }];
  }
  return [];
}

/**
 * Collect Spec warnings for an SSE stream. NDJSON / other kinds return [].
 * Prefers each event's `raw` block; falls back to stream-level BOM only.
 */
export function scanStreamSpecWarnings(record: Pick<StreamRecord, "streamKind" | "raw" | "events">): SseSpecWarning[] {
  if (record.streamKind !== "sse") return [];

  const warnings: SseSpecWarning[] = [];
  const streamLevel = lintSseStreamRaw(record.raw);
  // Avoid duplicating BOM if the first event block already carries it.
  const firstRaw = record.events[0]?.raw ?? "";
  const firstHasBom = firstRaw.charCodeAt(0) === 0xfeff;
  for (const w of streamLevel) {
    if (w.kind === "bom" && firstHasBom) continue;
    warnings.push(w);
  }

  for (const ev of record.events) {
    warnings.push(...lintSseEventBlock(ev.raw, ev.index));
  }
  return warnings;
}

/** Rebuild a standards-friendly `text/event-stream` body from parsed events. */
export function buildSseFixture(
  events: Array<Pick<SseEvent, "id" | "event" | "data" | "retry">>,
): string {
  if (events.length === 0) return "";

  const blocks = events.map((ev) => {
    const lines: string[] = [];
    if (ev.event && ev.event !== "message") {
      lines.push(`event: ${ev.event}`);
    }
    if (ev.id != null && ev.id !== "") {
      lines.push(`id: ${ev.id}`);
    }
    if (typeof ev.retry === "number" && Number.isFinite(ev.retry)) {
      lines.push(`retry: ${Math.trunc(ev.retry)}`);
    }
    const data = ev.data ?? "";
    const dataLines = data.split("\n");
    for (const line of dataLines) {
      lines.push(`data: ${line}`);
    }
    // Spec allows events with only id/retry and no data; keep a minimal data line
    // when nothing else was emitted so the block is still a visible event for mocks.
    if (lines.length === 0) {
      lines.push("data:");
    }
    return lines.join("\n");
  });

  return `${blocks.join("\n\n")}\n\n`;
}
