/** In-memory ring buffer for page→panel relay messages while no DevTools panel is connected. */

export type BufferedRelay = {
  type: string;
  /** Approximate serialized size contribution for byte budget. */
  byteSize: number;
};

export type RelayBufferOptions = {
  maxMessages: number;
  maxBytes: number;
};

export type RelayBufferStats = {
  truncated: boolean;
  dropped: number;
};

export class RelayBuffer<T extends BufferedRelay> {
  private readonly items: T[] = [];
  private bytes = 0;
  private truncated = false;
  private dropped = 0;

  constructor(private readonly options: RelayBufferOptions) {}

  get size(): number {
    return this.items.length;
  }

  get byteSize(): number {
    return this.bytes;
  }

  get stats(): RelayBufferStats {
    return { truncated: this.truncated, dropped: this.dropped };
  }

  push(item: T): void {
    this.items.push(item);
    this.bytes += item.byteSize;
    while (
      this.items.length > this.options.maxMessages ||
      this.bytes > this.options.maxBytes
    ) {
      const removed = this.items.shift();
      if (!removed) break;
      this.bytes -= removed.byteSize;
      this.truncated = true;
      this.dropped += 1;
    }
  }

  /** Drain all items (order preserved). */
  drain(): T[] {
    if (this.items.length === 0) return [];
    const out = this.items.splice(0, this.items.length);
    this.bytes = 0;
    return out;
  }

  clear(): void {
    this.items.length = 0;
    this.bytes = 0;
    this.truncated = false;
    this.dropped = 0;
  }
}

/** Rough size for budget accounting (not exact JSON size). */
export function estimateRelayBytes(msg: { type: string; payload?: unknown }): number {
  const p = msg.payload;
  if (!p || typeof p !== "object") return 64;
  const o = p as Record<string, unknown>;
  if (typeof o.text === "string") return 64 + o.text.length;
  let n = 128;
  if (typeof o.url === "string") n += o.url.length;
  if (typeof o.requestPayloadPreview === "string") n += o.requestPayloadPreview.length;
  if (typeof o.message === "string") n += o.message.length;
  return n;
}
