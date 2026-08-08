import { describe, it, expect } from "vitest";
import {
  classifyHttpStatus,
  classifyThrownError,
  isStreamCloseReason,
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
});
