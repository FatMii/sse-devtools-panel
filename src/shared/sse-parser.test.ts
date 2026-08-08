import { describe, it, expect } from "vitest";
import { SseParser, extractMergedData } from "./sse-parser";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("sse-parser", () => {
  it("matches previous script coverage", () => {
    const parser = new SseParser();
    const events1 = parser.push('data: {"a":1}\n\n');
    assert(events1.length === 1, "expected 1 event");
    assert(events1[0].data === '{"a":1}', "data mismatch");

    const events2 = parser.push("event: delta\ndata: hello\ndata: world\n\n");
    assert(events2.length === 1, "expected multiline data event");
    assert(events2[0].event === "delta", "event name");
    assert(events2[0].data === "hello\nworld", "multiline data");

    // split chunk across boundary
    const p2 = new SseParser();
    assert(p2.push("data: pa").length === 0, "incomplete should yield 0");
    const mid = p2.push("rt\n\ndata: done\n\n");
    assert(mid.length === 2, "two events after complete");
    assert(mid[0].data === "part", "first reassembled");
    assert(mid[1].data === "done", "second");

    const merged = extractMergedData([...events1, ...events2]);
    assert(merged === '{"a":1}hello\nworld', "merged");
  });
});
