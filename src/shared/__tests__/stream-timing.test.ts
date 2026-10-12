import { describe, it, expect } from "vitest";
import {
  aggregateArrivalLod,
  buildArrivalWaitSeries,
  buildGapHistogram,
  buildTimingAnomalies,
  buildTimingInsights,
  buildTimingMarks,
  buildTimingPhases,
  clampTimingView,
  collectEventGaps,
  findNearestEventIndex,
  fitTimingView,
  gapsInBin,
  hitTestArrivalMark,
  isHotGapBin,
  isHotGapBinFromMs,
  isStallGapMs,
  largestGaps,
  TIMING_ANOMALY_STALL_LIMIT,
  TIMING_LANE_MAX,
  TIMING_WATERFALL_LIMIT,
  collectTimingLaneTypes,
  hitTestTimingLaneMark,
  normalizeTimingEventType,
  waterfallBarKind,
  panTimingView,
  TIMING_HOT_GAP_MS,
  TIMING_STALL_MS,
  timingSpanMs,
  zoomTimingView,
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

    const marks = buildTimingMarks(events, 1000);
    assert(marks.length === 4, "marks");
    assert(marks[0].offsetMs === 0, "origin");
    assert(marks[3].offsetMs === 1065, "last offset");
    assert(marks[3].gapFromPrevMs === 1000, "mark gap");
    assert(timingSpanMs(marks) === 1065, "span");

    const top = largestGaps(gaps, 2);
    assert(top[0].gapMs === 1000 && top[1].gapMs === 50, "largest");
  });

  it("classifies waterfall bar tones and top-N waits", () => {
    expect(TIMING_WATERFALL_LIMIT).toBe(10);
    expect(waterfallBarKind(100)).toBe("ok");
    expect(waterfallBarKind(400)).toBe("stall");
    expect(waterfallBarKind(999)).toBe("stall");
    expect(waterfallBarKind(1000)).toBe("severe");
    const gaps = [
      { afterIndex: 2, gapMs: 50 },
      { afterIndex: 5, gapMs: 1800 },
      { afterIndex: 9, gapMs: 600 },
    ];
    expect(largestGaps(gaps, TIMING_WATERFALL_LIMIT).map((g) => g.afterIndex)).toEqual([
      5, 9, 2,
    ]);
  });

  it("collects event-type swimlanes with preferred order", () => {
    expect(normalizeTimingEventType("")).toBe("message");
    expect(normalizeTimingEventType("  delta ")).toBe("delta");
    expect(TIMING_LANE_MAX).toBe(8);

    const types = collectTimingLaneTypes([
      { event: "ping" },
      { event: "custom" },
      { event: "message" },
      { event: "custom" },
      { event: "" },
      { event: "delta" },
      { event: "error" },
    ]);
    expect(types.slice(0, 4)).toEqual(["message", "delta", "ping", "error"]);
    expect(types).toContain("custom");

    const capped = collectTimingLaneTypes(
      Array.from({ length: 12 }, (_, i) => ({ event: `t${i}` })),
      [],
      3,
    );
    expect(capped).toHaveLength(3);

    const marks = [
      { index: 0, event: "message", offsetMs: 0 },
      { index: 1, event: "ping", offsetMs: 100 },
      { index: 2, event: "message", offsetMs: 200 },
    ];
    expect(hitTestTimingLaneMark(marks, "ping", 50, 100, 0, 200, 20)).toBe(1);
    expect(hitTestTimingLaneMark(marks, "message", 5, 100, 0, 200, 20)).toBe(0);
    expect(hitTestTimingLaneMark(marks, "message", 50, 100, 0, 200, 20)).toBeNull();
  });

  it("builds stall / reconnect anomaly pins", () => {
    expect(TIMING_ANOMALY_STALL_LIMIT).toBe(5);

    const marks = [
      { index: 0, offsetMs: 0 },
      { index: 1, offsetMs: 100, gapFromPrevMs: 100 },
      { index: 2, offsetMs: 800, gapFromPrevMs: 700 },
      { index: 3, offsetMs: 900, gapFromPrevMs: 100 },
    ];
    const events = marks.map((m) => ({
      index: m.index,
      receivedAt: 1000 + m.offsetMs,
      id: String(m.index),
    }));
    const anomalies = buildTimingAnomalies({
      marks,
      events,
      originMs: 1000,
      reconnects: [{ at: 1500, reconnectCount: 1, lastEventId: "1" }],
      stallLimit: 2,
    });
    expect(anomalies.some((a) => a.kind === "stall" && a.jumpIndex === 2)).toBe(true);
    expect(anomalies.some((a) => a.kind === "reconnect" && a.reconnectCount === 1)).toBe(true);
  });

  it("exposes unified stall / hot thresholds", () => {
    expect(TIMING_STALL_MS).toBe(400);
    expect(TIMING_HOT_GAP_MS).toBe(400);
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
    const insights = buildTimingInsights({
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

  it("aggregates arrival LOD buckets and hit-tests nearest marks", () => {
    const marks = [
      { index: 0, offsetMs: 0, gapFromPrevMs: undefined },
      { index: 1, offsetMs: 100, gapFromPrevMs: 100 },
      { index: 2, offsetMs: 500, gapFromPrevMs: 400 },
      { index: 3, offsetMs: 520, gapFromPrevMs: 20 },
    ];
    const { buckets, maxCount } = aggregateArrivalLod(marks, 100, 0, 1000);
    expect(buckets).toHaveLength(100);
    expect(maxCount).toBeGreaterThanOrEqual(1);
    const stallBucket = buckets[Math.floor((500 / 1000) * 100)];
    expect(stallBucket.stallCount).toBeGreaterThanOrEqual(1);
    expect(stallBucket.jumpIndex).toBe(2);

    expect(hitTestArrivalMark(marks, 50, 100, 0, 1000)).toBe(2);
    expect(hitTestArrivalMark(marks, 0, 100, 0, 1000)).toBe(0);
    expect(hitTestArrivalMark(marks, 52, 100, 0, 1000, 0.5)).toBe(3);
    expect(hitTestArrivalMark([], 10, 100, 0, 1000)).toBeNull();
  });

  it("builds a wait-ms series aligned with inter-event gaps", () => {
    const marks = [
      { offsetMs: 0 },
      { offsetMs: 100, gapFromPrevMs: 100 },
      { offsetMs: 700, gapFromPrevMs: 600 },
      { offsetMs: 800, gapFromPrevMs: 100 },
    ];
    const series = buildArrivalWaitSeries(marks, 0, 1000, 10);
    expect(series.bucketCount).toBe(10);
    expect(series.waitsMs).toHaveLength(10);
    // 100→700 wait of 600ms covers buckets ~1–6
    expect(series.waitsMs[2]).toBe(600);
    expect(series.waitsMs[5]).toBe(600);
    expect(series.maxWaitMs).toBe(600);
    expect(buildArrivalWaitSeries([], 0, 1000, 4).waitsMs).toEqual([0, 0, 0, 0]);
  });

  it("builds TTFT / steady / stall / done phase bands", () => {
    const marks = [
      { offsetMs: 200 },
      { offsetMs: 300, gapFromPrevMs: 100 },
      { offsetMs: 900, gapFromPrevMs: 600 },
      { offsetMs: 1000, gapFromPrevMs: 100 },
    ];
    const live = buildTimingPhases({ marks, spanMs: 1000, ended: false });
    expect(live.map((s) => s.kind)).toEqual(["ttft", "steady", "stall", "steady"]);
    expect(live[0]).toEqual({ kind: "ttft", startMs: 0, endMs: 200 });
    expect(live[2]).toEqual({ kind: "stall", startMs: 300, endMs: 900 });

    const ended = buildTimingPhases({ marks, spanMs: 1300, ended: true });
    expect(ended.at(-1)).toEqual({ kind: "done", startMs: 1000, endMs: 1300 });

    const emptyLive = buildTimingPhases({ marks: [], spanMs: 500, ended: false });
    expect(emptyLive).toEqual([{ kind: "ttft", startMs: 0, endMs: 500 }]);
  });

  it("clamps zooms and pans the timing view window", () => {
    expect(fitTimingView(2000)).toEqual({ startMs: 0, endMs: 2000 });
    expect(clampTimingView({ startMs: -100, endMs: 500 }, 1000)).toEqual({
      startMs: 0,
      endMs: 600,
    });
    expect(zoomTimingView({ startMs: 0, endMs: 2000 }, 2000, 0.5, 0.5)).toEqual({
      startMs: 500,
      endMs: 1500,
    });
    const panned = panTimingView({ startMs: 500, endMs: 1500 }, 2000, 800);
    expect(panned).toEqual({ startMs: 1000, endMs: 2000 });
  });
});
