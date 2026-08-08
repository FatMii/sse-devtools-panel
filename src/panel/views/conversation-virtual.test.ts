import { describe, it, expect } from "vitest";
import { computeConvVirtualWindow, estimateCols, wrapTextToRows } from "./conversation-virtual";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("conversation-virtual", () => {
  it("matches previous script coverage", () => {
    assert(wrapTextToRows("", 10).length === 0, "empty");
    assert(JSON.stringify(wrapTextToRows("abc", 10)) === JSON.stringify(["abc"]), "short line");
    assert(
      JSON.stringify(wrapTextToRows("abcdefghijklmnop", 8)) ===
        JSON.stringify(["abcdefgh", "ijklmnop"]),
      "soft wrap",
    );
    assert(JSON.stringify(wrapTextToRows("a\nb", 10)) === JSON.stringify(["a", "b"]), "hard break");
    assert(JSON.stringify(wrapTextToRows("a\n", 10)) === JSON.stringify(["a", ""]), "trailing nl");

    const win = computeConvVirtualWindow(0, 100, 1000, 18, 2);
    assert(win.start === 0, "start");
    assert(win.paddingTop === 0, "pad top");
    assert(win.end > 0 && win.end < 1000, "end windowed");
    assert(win.paddingBottom === (1000 - win.end) * 18, "pad bottom");

    assert(estimateCols(400) >= 20, "cols");
  });
});
