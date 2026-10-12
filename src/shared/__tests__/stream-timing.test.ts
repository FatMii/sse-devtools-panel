import { describe, it, expect } from "vitest";
import {
  buildGapHistogram,
  buildTimelineInsights,
  buildTimelineMarks,
  collectEventGaps,
  findNearestEventIndex,
  gapsInBin,
  isHotGapBin,
  isHotGapBinFromMs,
  isStallGapMs,
  largestGaps,
  TIMELINE_HOT_GAP_MS,
  TIMELINE_STALL_MS,
  timelineSpanMs,
} from "../stream-timing";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("stream-timing", () => {
  it("matches previous script coverage", () => {
    const events = [
      { index: 0, event: "message", receivedAt: 1000 },
      { index: 1, event: "message", receivedAt: 1015 },
      { index: 2, event: "message", receivedAt: 1065 },
      { index: 3, event: "message", receivedAt: 2065 },
    ];

    const gaps = collectEventGaps(events);
    assert(gaps.length === 3, "gap count");
    assert(gaps[0].gapMs === 15 && gaps[0].afterIndex === 1, "first gap");
    assert(gaps[2].gapMs === 1000 && gaps[2].afterIndex === 3, "stall gap");

    const hist = buildGapHistogram(gaps);
    assert(
      hist.some((b) => b.label === "10–25" && b.count === 1),
      "bin 10-25",
    );
    assert(
      hist.some((b) => b.label === "50–100" && b.count === 1),
      "bin 50-100",
    );
    assert(
      hist.some((b) => b.label === "1000+" && b.count === 1),
      "bin 1000+",
    );

    const marks = buildTimelineMarks(events, 1000);
    assert(marks.length === 4, "marks");
    assert(marks[0].offsetMs === 0, "origin");
    assert(marks[3].offsetMs === 1065, "last offset");
    assert(marks[3].gapFromPrevMs === 1000, "mark gap");
    assert(timelineSpanMs(marks) === 1065, "span");

    const top = largestGaps(gaps, 2);
    assert(top[0].gapMs === 1000 && top[1].gapMs === 50, "largest");
  });

  it("exposes unified stall / hot thresholds", () => {
    expect(TIMELINE_STALL_MS).toBe(400);
    expect(TIMELINE_HOT_GAP_MS).toBe(400);
    expect(isStallGapMs(399)).toBe(false);
    expect(isStallGapMs(400)).toBe(true);
    expect(isStallGapMs(undefined)).toBe(false);
    expect(isHotGapBinFromMs(250)).toBe(false);
    expect(isHotGapBinFromMs(400)).toBe(true);
    expect(isHotGapBinFromMs(1000)).toBe(true);
    expect(isHotGapBin({ fromMs: 250, toMs: 500 })).toBe(true);
    expect(isHotGapBin({ fromMs: 100, toMs: 250 })).toBe(false);
    expect(isHotGapBin({ fromMs: 1000, toMs: Number.POSITIVE_INFINITY })).toBe(true);

    const inBin = gapsInBin(
      [
        { afterIndex: 1, gapMs: 15 },
        { afterIndex: 2, gapMs: 900 },
        { afterIndex: 3, gapMs: 1200 },
      ],
      { fromMs: 500, toMs: 1000 },
    );
    expect(inBin).toEqual([{ afterIndex: 2, gapMs: 900 }]);
  });

  it("builds Insights from stalls and reconnects", () => {
    const events = [
      { index: 0, event: "message", receivedAt: 1000, id: "a" },
      { index: 1, event: "delta", receivedAt: 1500, id: "b" },
      { index: 2, event: "message", receivedAt: 2600, id: "c" },
    ];
    const gaps = collectEventGaps(events);
    const insights = buildTimelineInsights({
      gaps,
      events,
      reconnects: [
        { at: 1800, reconnectCount: 1, lastEventId: "b" },
        { at: 3000, reconnectCount: 2, lastEventId: "missing" },
      ],
      originMs: 1000,
      stallLimit: 2,
    });

    expect(insights.map((item) => item.kind)).toEqual(["stall", "stall", "reconnect", "reconnect"]);
    expect(insights[0]).toMatchObject({
      kind: "stall",
      rank: 1,
      afterIndex: 2,
      gapMs: 1100,
      jumpIndex: 2,
      eventName: "message",
    });
    expect(insights[2]).toMatchObject({
      kind: "reconnect",
      reconnectCount: 2,
      jumpIndex: 2,
    });
    expect(insights[3]).toMatchObject({
      kind: "reconnect",
      reconnectCount: 1,
      jumpIndex: 1,
    });
    expect(findNearestEventIndex(events, 1800, "b")).toBe(1);
    expect(findNearestEventIndex([], 1800)).toBeNull();
  });
});
