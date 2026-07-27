import type { ParsedSseEvent } from "./sse-parser";

/**
 * Incremental NDJSON / JSON Lines parser.
 * Each non-empty line becomes one logical event (data = line text).
 */
export class NdjsonParser {
  private buffer = "";
  private eventIndex = 0;

  push(chunk: string): ParsedSseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const events: ParsedSseEvent[] = [];

    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      events.push({
        event: "message",
        data: trimmed,
        raw: trimmed,
        index: this.eventIndex,
      });
      this.eventIndex += 1;
    }

    return events;
  }

  flush(): ParsedSseEvent[] {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (!remaining) return [];
    const event: ParsedSseEvent = {
      event: "message",
      data: remaining,
      raw: remaining,
      index: this.eventIndex,
    };
    this.eventIndex += 1;
    return [event];
  }
}
