import { describe, it, expect } from "vitest";
import { createStreamIdFactory, randomFrameToken } from "../stream-id";

describe("stream-id", () => {
  it("keeps ids unique across frames that start in the same millisecond", () => {
    const page = createStreamIdFactory("page0001");
    const frame = createStreamIdFactory("fram0001");
    const ids = [page(), page(), frame(), frame()];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("increments the sequence within one frame", () => {
    const nextId = createStreamIdFactory("abcd1234");

    expect(nextId()).toMatch(/-1$/);
    expect(nextId()).toMatch(/-2$/);
  });

  it("formats ids as prefix-timestamp-token-seq", () => {
    const nextId = createStreamIdFactory("abcd1234");

    expect(nextId()).toMatch(/^sse-\d+-abcd1234-\d+$/);
  });

  it("generates a non-empty base36 frame token", () => {
    expect(randomFrameToken()).toMatch(/^[0-9a-z]{1,8}$/);
  });
});
