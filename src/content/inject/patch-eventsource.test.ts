import { describe, it, expect } from "vitest";
import { eventTypeFromOnProperty, toSseFrame } from "./patch-eventsource";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("patch-eventsource", () => {
  it("matches previous script coverage", () => {
    assert(eventTypeFromOnProperty("onping") === "ping", "onping");
    assert(eventTypeFromOnProperty("onmessage") === "message", "onmessage");
    assert(eventTypeFromOnProperty("on") === null, "too short");
    assert(eventTypeFromOnProperty("message") === null, "not on*");
    assert(toSseFrame("ping", "hi").includes("event: ping\n"), "frame event");
    assert(toSseFrame("message", "hi").startsWith("data:"), "default message");
  });
});
