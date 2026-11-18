/**
 * Stream ids used as the panel's request key.
 *
 * Every frame runs its own copy of the injected page hooks, so a bare sequence
 * number can collide when two frames start a stream in the same millisecond.
 * A random per-frame token keeps ids apart while staying readable in the panel.
 */
const ID_PREFIX = "sse";

/** 8 base36 characters: enough to separate frames, short enough to stay readable. */
export function randomFrameToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Build `sse-<timestamp>-<token>-<seq>` ids; `token` defaults to a per-frame value. */
export function createStreamIdFactory(
  token: string = randomFrameToken(),
  prefix: string = ID_PREFIX,
): () => string {
  let seq = 0;
  return () => `${prefix}-${Date.now()}-${token}-${++seq}`;
}
