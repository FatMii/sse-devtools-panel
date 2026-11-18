import { describe, it, expect } from "vitest";
import {
  classifyHttpStatus,
  classifyThrownError,
  hasTerminalEvent,
  isStreamCloseReason,
  isTerminalEventData,
  latestEventIdFromEvents,
  normalizeReconnectMarks,
} from "../stream-close";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("stream-close", () => {
  it("matches previous script coverage", () => {
    const abortErr = classifyThrownError(
      Object.assign(new Error("The user aborted a request."), { name: "AbortError" }),
    );
    assert(abortErr.closeReason === "abort", "abort reason");
    assert(/aborted/i.test(abortErr.message), "abort message");

    const netErr = classifyThrownError(new Error("Failed to fetch"));
    assert(netErr.closeReason === "error", "network reason");

    const http = classifyHttpStatus(502);
    assert(http.closeReason === "http_error", "http reason");
    assert(http.message === "HTTP 502", "http message");

    assert(isStreamCloseReason("abort"), "valid reason");
    assert(!isStreamCloseReason("nope"), "invalid reason");

    assert(latestEventIdFromEvents([{ id: "1" }, { id: "2" }, {}]) === "2", "latest id");
    assert(latestEventIdFromEvents([{}]) === undefined, "no id");

    const marks = normalizeReconnectMarks([
      { at: 10, reconnectCount: 1, lastEventId: "a" },
      { at: "bad" },
      { at: 20, reconnectCount: 2 },
    ]);
    assert(marks?.length === 2, "reconnect marks");
    assert(marks[0].lastEventId === "a", "reconnect id");
    assert(marks[1].lastEventId === undefined, "reconnect id optional");
  });

  it("detects terminal markers in stream payloads", () => {
    assert(isTerminalEventData("[DONE]"), "openai done sentinel");
    assert(isTerminalEventData("  [done]  "), "sentinel is trimmed/case-insensitive");
    assert(isTerminalEventData('{"type":"finished","status":"completed"}'), "type=finished");
    assert(isTerminalEventData('{"status":"finished"}'), "status=finished");
    assert(isTerminalEventData('{"event":"done"}'), "event=done");
    assert(isTerminalEventData('{"choices":[{"finish_reason":"stop"}]}'), "finish_reason");

    assert(!isTerminalEventData('{"type":"content","content":"hi"}'), "content chunk");
    assert(!isTerminalEventData('{"status":"running"}'), "running status");
    assert(!isTerminalEventData("not json"), "plain text");
    assert(!isTerminalEventData(""), "empty payload");
    assert(!isTerminalEventData("[1,2,3]"), "array payload");
  });

  it("looks only at the tail when deciding whether a stream finished", () => {
    const events = [
      { data: "[DONE]" },
      ...Array.from({ length: 10 }, (_, i) => ({ data: `{"seq":${i}}` })),
    ];
    assert(!hasTerminalEvent(events), "terminal marker out of lookback window");
    assert(hasTerminalEvent(events, 11), "lookback window covers the marker");
    assert(hasTerminalEvent([{ data: '{"type":"content"}' }, { data: "[DONE]" }]), "tail marker");
    assert(!hasTerminalEvent([]), "no events");
  });
});
