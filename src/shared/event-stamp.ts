/** Parsed event fields before client receive time is assigned. */
export type StampableEvent = {
  id?: string;
  event: string;
  data: string;
  retry?: number;
  raw: string;
  index: number;
};

/**
 * Assign monotonic `receivedAt` timestamps.
 *
 * Network chunks often contain many framed events; a single Date.now() would
 * collapse Timeline gaps to zero. Within a batch we keep order with ≥1ms steps,
 * and never go backwards relative to the previous event on the stream.
 *
 * These are receive-order stamps, not true on-the-wire write times.
 */
export function stampReceivedAt<T extends StampableEvent>(
  events: ReadonlyArray<T>,
  options?: { now?: number; previousReceivedAt?: number },
): Array<T & { receivedAt: number }> {
  if (events.length === 0) return [];
  const now = options?.now ?? Date.now();
  let cursor = options?.previousReceivedAt ?? 0;
  return events.map((e) => {
    const receivedAt = Math.max(now, cursor + 1);
    cursor = receivedAt;
    return { ...e, receivedAt };
  });
}
