import type { StreamCloseReason, StreamReconnectMark } from "./types";

export function isAbortLikeError(err: unknown): boolean {
  if (err == null) return false;
  if (
    typeof DOMException !== "undefined" &&
    err instanceof DOMException &&
    err.name === "AbortError"
  ) {
    return true;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    if (/aborted|AbortError|The user aborted/i.test(err.message)) return true;
  }
  return /AbortError|aborted|The user aborted/i.test(String(err));
}

export function errorMessageOf(err: unknown, fallback = "Unknown error"): string {
  if (err instanceof Error && err.message) return err.message;
  const text = String(err ?? "").trim();
  return text || fallback;
}

/** Classify a thrown failure from fetch / stream read. */
export function classifyThrownError(err: unknown): {
  closeReason: Extract<StreamCloseReason, "abort" | "error">;
  message: string;
} {
  const message = errorMessageOf(err);
  if (isAbortLikeError(err) || /aborted|AbortError/i.test(message)) {
    return { closeReason: "abort", message: message || "Aborted" };
  }
  return { closeReason: "error", message };
}

export function classifyHttpStatus(status: number): {
  closeReason: Extract<StreamCloseReason, "http_error">;
  message: string;
} {
  return { closeReason: "http_error", message: `HTTP ${status}` };
}

export function isStreamCloseReason(value: unknown): value is StreamCloseReason {
  return value === "complete" || value === "abort" || value === "error" || value === "http_error";
}

export function normalizeReconnectMarks(raw: unknown): StreamReconnectMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StreamReconnectMark[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.at !== "number" || typeof row.reconnectCount !== "number") continue;
    const mark: StreamReconnectMark = {
      at: row.at,
      reconnectCount: row.reconnectCount,
    };
    if (typeof row.lastEventId === "string" && row.lastEventId) {
      mark.lastEventId = row.lastEventId;
    }
    out.push(mark);
  }
  return out.length > 0 ? out : undefined;
}

/** Payload words that mean "the producer says this stream is over". */
const TERMINAL_WORDS = new Set([
  "done",
  "end",
  "ended",
  "finish",
  "finished",
  "complete",
  "completed",
  "close",
  "closed",
  "success",
]);

const TERMINAL_TYPE_KEYS = ["type", "event", "status", "state", "phase"] as const;

/**
 * True when one parsed payload is a terminal marker: `[DONE]`, a JSON object whose
 * type/event/status/state/phase is terminal, or an OpenAI chunk carrying finish_reason.
 */
export function isTerminalEventData(data: string): boolean {
  const trimmed = data.trim();
  if (!trimmed) return false;
  if (/^\[DONE\]$/i.test(trimmed)) return true;
  if (trimmed.length > 4096) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;

  const row = parsed as Record<string, unknown>;
  for (const key of TERMINAL_TYPE_KEYS) {
    const value = row[key];
    if (typeof value === "string" && TERMINAL_WORDS.has(value.trim().toLowerCase())) return true;
  }

  const choices = row.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === "object") {
      const finishReason = (first as Record<string, unknown>).finish_reason;
      if (typeof finishReason === "string" && finishReason.trim()) return true;
    }
  }
  return false;
}

/**
 * True when the last few events already carry a terminal marker.
 * Used to tell "client hung up after the server finished" from a real abort.
 */
export function hasTerminalEvent(events: Array<{ data?: string }>, lookback = 5): boolean {
  const from = Math.max(0, events.length - Math.max(1, lookback));
  for (let i = events.length - 1; i >= from; i -= 1) {
    if (isTerminalEventData(events[i]?.data ?? "")) return true;
  }
  return false;
}

/** Derive lastEventId from parsed SSE events (latest non-empty id). */
export function latestEventIdFromEvents(events: Array<{ id?: string }>): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const id = events[i]?.id;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}
