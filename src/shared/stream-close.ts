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

/** Derive lastEventId from parsed SSE events (latest non-empty id). */
export function latestEventIdFromEvents(events: Array<{ id?: string }>): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const id = events[i]?.id;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}
