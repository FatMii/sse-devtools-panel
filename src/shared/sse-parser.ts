import type { SseEvent } from "./types";

export type ParsedSseEvent = Omit<SseEvent, "receivedAt">;

/**
 * Incremental SSE parser. Feed raw text chunks; completed events are returned.
 */
export class SseParser {
  private buffer = "";
  private eventIndex = 0;

  push(chunk: string): ParsedSseEvent[] {
    this.buffer += chunk;
    const events: ParsedSseEvent[] = [];

    // Normalize CRLF → LF for splitting
    this.buffer = this.buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    let sep: number;
    while ((sep = this.buffer.indexOf("\n\n")) !== -1) {
      const block = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      const parsed = parseSseBlock(block, this.eventIndex);
      if (parsed) {
        events.push(parsed);
        this.eventIndex += 1;
      }
    }

    return events;
  }

  /** Flush any remaining incomplete block as a final event (optional on stream end). */
  flush(): ParsedSseEvent[] {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (!remaining) return [];
    const parsed = parseSseBlock(remaining, this.eventIndex);
    if (!parsed) return [];
    this.eventIndex += 1;
    return [parsed];
  }
}

function parseSseBlock(block: string, index: number): ParsedSseEvent | null {
  if (!block.trim() || block.startsWith(":")) {
    const lines = block.split("\n");
    const onlyComments = lines.every((l) => !l.trim() || l.startsWith(":"));
    if (onlyComments) return null;
  }

  let id: string | undefined;
  let event = "message";
  const dataLines: string[] = [];
  let retry: number | undefined;

  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "event":
        event = value || "message";
        break;
      case "data":
        dataLines.push(value);
        break;
      case "id":
        id = value;
        break;
      case "retry": {
        const n = Number.parseInt(value, 10);
        if (!Number.isNaN(n)) retry = n;
        break;
      }
      default:
        break;
    }
  }

  if (dataLines.length === 0 && event === "message" && id === undefined && retry === undefined) {
    return null;
  }

  return {
    id,
    event,
    data: dataLines.join("\n"),
    retry,
    raw: block,
    index,
  };
}

export function extractMergedData(events: Array<Pick<SseEvent, "data">>): string {
  return events.map((e) => e.data).join("");
}
