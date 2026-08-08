import { describe, it, expect } from "vitest";
import { planTextPaneUpdate } from "../conversation-text";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("conversation-text", () => {
  it("matches previous script coverage", () => {
    assert(planTextPaneUpdate("hello", "hello").mode === "noop", "noop");
    const append = planTextPaneUpdate("hello", "hello!");
    assert(append.mode === "append" && append.suffix === "!", "append");
    assert(planTextPaneUpdate("", "hello").mode === "replace", "replace from empty");
    assert(planTextPaneUpdate("abc", "axc").mode === "replace", "replace diverge");
  });
});
