import type { ParsedSseEvent } from "./sse-parser";

/** Connect RPC envelope: 1-byte flags + 4-byte BE length + payload. */
export const CONNECT_FLAG_COMPRESSED = 0x01;
export const CONNECT_FLAG_END_STREAM = 0x02;
export const CONNECT_MAX_FRAME_BYTES = 16 * 1024 * 1024;

export type ConnectJsonFrame = {
  /** Raw Connect flags byte. */
  flags: number;
  /** True when END_STREAM / trailer bit is set (flag & 0x02). */
  endStream: boolean;
  /** UTF-8 JSON payload (data frames only). */
  jsonText: string;
};

/**
 * Incremental Connect+JSON frame splitter (binary).
 * Spec: https://connectrpc.com/docs/protocol (#Length-Prefixed-Data)
 */
export class ConnectBinaryFramer {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): ConnectJsonFrame[] {
    if (chunk.byteLength === 0) return [];
    const merged = new Uint8Array(this.buffer.length + chunk.byteLength);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const out: ConnectJsonFrame[] = [];
    let offset = 0;
    const decoder = new TextDecoder("utf-8", { fatal: false });

    while (this.buffer.length - offset >= 5) {
      const flags = this.buffer[offset]!;
      const length =
        ((this.buffer[offset + 1]! << 24) |
          (this.buffer[offset + 2]! << 16) |
          (this.buffer[offset + 3]! << 8) |
          this.buffer[offset + 4]!) >>>
        0;

      if (length > CONNECT_MAX_FRAME_BYTES) {
        // Desync — drop one byte and resync best-effort.
        offset += 1;
        continue;
      }
      if (this.buffer.length - offset < 5 + length) break;

      const payload = this.buffer.subarray(offset + 5, offset + 5 + length);
      offset += 5 + length;

      const endStream = (flags & CONNECT_FLAG_END_STREAM) !== 0;
      if (endStream) {
        out.push({ flags, endStream: true, jsonText: "" });
        continue;
      }
      if ((flags & CONNECT_FLAG_COMPRESSED) !== 0) {
        // Compressed payloads are rare for kimi connect+json; skip rather than explode.
        continue;
      }
      const jsonText = decoder.decode(payload);
      if (!jsonText.trim()) continue;
      out.push({ flags, endStream: false, jsonText });
    }

    this.buffer = this.buffer.subarray(offset);
    return out;
  }

  flush(): ConnectJsonFrame[] {
    this.buffer = new Uint8Array(0);
    return [];
  }
}

/**
 * Panel-side parser: each completed Connect JSON object becomes one logical event.
 * Inject posts one JSON string per data frame.
 */
export class ConnectJsonParser {
  private buffer = "";
  private eventIndex = 0;

  push(chunk: string): ParsedSseEvent[] {
    if (!chunk) return [];
    this.buffer += chunk;
    const events: ParsedSseEvent[] = [];

    while (true) {
      const trimmedStart = this.buffer.search(/\S/);
      if (trimmedStart === -1) {
        this.buffer = "";
        break;
      }
      if (trimmedStart > 0) this.buffer = this.buffer.slice(trimmedStart);

      if (this.buffer[0] !== "{" && this.buffer[0] !== "[") {
        const nl = this.buffer.indexOf("\n");
        if (nl === -1) break;
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) events.push(this.toEvent("message", line));
        continue;
      }

      const end = findJsonEnd(this.buffer);
      if (end < 0) break;
      const jsonText = this.buffer.slice(0, end + 1).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!jsonText) continue;
      events.push(this.toEvent(eventNameFromJson(jsonText), jsonText));
    }

    return events;
  }

  flush(): ParsedSseEvent[] {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (!remaining) return [];
    return [this.toEvent(eventNameFromJson(remaining), remaining)];
  }

  private toEvent(event: string, data: string): ParsedSseEvent {
    const ev: ParsedSseEvent = {
      event,
      data,
      raw: data,
      index: this.eventIndex,
    };
    this.eventIndex += 1;
    return ev;
  }
}

function eventNameFromJson(jsonText: string): string {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      if (typeof o.mask === "string" && o.mask) return o.mask;
      if (o.heartbeat != null) return "heartbeat";
      if (typeof o.op === "string" && o.op) return o.op;
    }
  } catch {
    // ignore
  }
  return "message";
}

/** Return index of closing brace/bracket for a JSON value starting at 0, or -1. */
function findJsonEnd(text: string): number {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      const top = stack[stack.length - 1];
      if ((ch === "}" && top === "{") || (ch === "]" && top === "[")) {
        stack.pop();
        if (stack.length === 0) return i;
      } else {
        return -1;
      }
    }
  }
  return -1;
}
