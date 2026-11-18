import { describe, it, expect } from "vitest";
import { describeAbortMessage, statusLabel, streamStatusShort } from "../format";

describe("abort presentation", () => {
  it("keeps aborted separate from error", () => {
    expect(statusLabel("aborted")).not.toBe(statusLabel("error"));
    expect(streamStatusShort("aborted")).not.toBe(streamStatusShort("error"));
    expect(statusLabel("aborted")).toBeTruthy();
  });

  it("humanizes Chrome's reasonless abort", () => {
    const text = describeAbortMessage("signal is aborted without reason");
    expect(text).toBeTruthy();
    expect(text).not.toMatch(/signal is aborted/i);
  });

  it("humanizes a bare AbortError message", () => {
    expect(describeAbortMessage("AbortError: The user aborted a request.")).not.toMatch(
      /^AbortError/i,
    );
  });

  it("passes through a meaningful abort reason", () => {
    expect(describeAbortMessage("user clicked stop")).toBe("user clicked stop");
  });

  it("does not throw on empty input", () => {
    expect(describeAbortMessage("   ")).toBeTruthy();
  });
});
