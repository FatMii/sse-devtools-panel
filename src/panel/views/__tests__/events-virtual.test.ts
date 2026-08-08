import { describe, it, expect } from "vitest";
import { computeVirtualWindow, isNearBottom, EVENTS_VIRTUAL_OVERSCAN } from "../events-virtual";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("events-virtual", () => {
  it("matches previous script coverage", () => {
    const empty = computeVirtualWindow({
      scrollTop: 0,
      viewportHeight: 400,
      rowHeight: 29,
      total: 0,
    });
    assert(empty.start === 0 && empty.end === 0, "empty total");
    assert(empty.paddingTop === 0 && empty.paddingBottom === 0, "empty padding");

    const short = computeVirtualWindow({
      scrollTop: 0,
      viewportHeight: 400,
      rowHeight: 29,
      total: 5,
    });
    assert(short.start === 0 && short.end === 5, "short list fits viewport");
    assert(short.paddingTop === 0 && short.paddingBottom === 0, "short list no padding");

    const mid = computeVirtualWindow({
      scrollTop: 29 * 100,
      viewportHeight: 290,
      rowHeight: 29,
      total: 1000,
      overscan: 8,
    });
    assert(mid.start === 100 - 8, `mid start got ${mid.start}`);
    assert(mid.end === 100 - 8 + Math.ceil(290 / 29) + 1 + 16, `mid end got ${mid.end}`);
    assert(mid.paddingTop === mid.start * 29, "mid paddingTop");
    assert(mid.paddingBottom === (1000 - mid.end) * 29, "mid paddingBottom");

    const bottom = computeVirtualWindow({
      scrollTop: 29 * 990,
      viewportHeight: 290,
      rowHeight: 29,
      total: 1000,
      overscan: 8,
    });
    assert(bottom.end === 1000, "bottom end clamped");
    assert(bottom.paddingBottom === 0, "bottom paddingBottom");
    assert(bottom.start >= 0, "bottom start non-neg");

    const overscanClamp = computeVirtualWindow({
      scrollTop: 0,
      viewportHeight: 100,
      rowHeight: 29,
      total: 1000,
      overscan: EVENTS_VIRTUAL_OVERSCAN,
    });
    assert(overscanClamp.start === 0, "overscan start clamped to 0");

    assert(isNearBottom(0, 1000, 1000, 48) === true, "fills viewport is near bottom");
    assert(isNearBottom(900, 1000, 100, 48) === true, "within threshold");
    assert(isNearBottom(800, 1000, 100, 48) === false, "scrolled up");
  });
});
