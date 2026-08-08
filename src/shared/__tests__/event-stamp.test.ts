import { describe, it, expect } from "vitest";
import { stampReceivedAt } from "../event-stamp";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("event-stamp", () => {
  it("matches previous script coverage", () => {
    const base = [
      { event: "message", data: "a", raw: "a", index: 0 },
      { event: "message", data: "b", raw: "b", index: 1 },
      { event: "message", data: "c", raw: "c", index: 2 },
    ];

    const sameChunk = stampReceivedAt(base, { now: 1000 });
    assert(sameChunk[0].receivedAt === 1000, "first");
    assert(sameChunk[1].receivedAt === 1001, "second spaced");
    assert(sameChunk[2].receivedAt === 1002, "third spaced");

    const continued = stampReceivedAt(base.slice(0, 1), {
      now: 1000,
      previousReceivedAt: 5000,
    });
    assert(continued[0].receivedAt === 5001, "monotonic vs previous");

    assert(stampReceivedAt([], { now: 1 }).length === 0, "empty");
  });
});
