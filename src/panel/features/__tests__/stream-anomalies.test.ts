import { afterEach, describe, expect, it } from "vitest";
import {
  setActiveTimingStallMs,
  TIMING_STALL_MS,
  TIMING_WATERFALL_LIMIT,
} from "../../../shared/stream-timing";
import type { StreamRecord } from "../../../shared/types";
import { clearStreamAnomalyCaches, scanStreamAnomalies } from "../stream-anomalies";

function record(
  events: Array<{ index: number; receivedAt: number; data?: string }>,
  requestId = "req",
): StreamRecord {
  return {
    requestId,
    url: "https://example.com/sse",
    method: "POST",
    transport: "fetch",
    streamKind: "sse",
    startedAt: 0,
    streamStatus: "done",
    raw: "",
    events: events.map((ev) => ({
      index: ev.index,
      event: "message",
      data: ev.data ?? "ok",
      raw: "",
      receivedAt: ev.receivedAt,
    })),
  };
}

afterEach(() => {
  setActiveTimingStallMs(TIMING_STALL_MS);
  clearStreamAnomalyCaches();
});

describe("scanStreamAnomalies timing stalls", () => {
  it("ignores gaps under the stall threshold", () => {
    const found = scanStreamAnomalies(
      record([
        { index: 0, receivedAt: 1_000 },
        { index: 1, receivedAt: 1_200 },
      ]),
    );
    expect(found.some((item) => item.kind === "stall")).toBe(false);
  });

  it("lists a stall on the event that arrived after the wait", () => {
    const found = scanStreamAnomalies(
      record([
        { index: 4, receivedAt: 1_000, data: "" },
        { index: 9, receivedAt: 3_100, data: "ok" },
      ]),
    );
    expect(found.map((item) => item.kind)).toEqual(["empty-data", "stall"]);
    const stall = found.find((item) => item.kind === "stall");
    expect(stall?.eventIndex).toBe(9);
    expect(stall?.message).toContain("2.1 s");
  });

  it("drops a wait that the raised stall threshold no longer counts", () => {
    const sample = record(
      [
        { index: 0, receivedAt: 0 },
        { index: 1, receivedAt: 500 },
      ],
      "threshold",
    );
    expect(scanStreamAnomalies(sample).some((item) => item.kind === "stall")).toBe(true);
    setActiveTimingStallMs(1000);
    expect(scanStreamAnomalies(sample).some((item) => item.kind === "stall")).toBe(false);
  });

  it("keeps only the longest stalls, up to the timing list limit", () => {
    const events = [{ index: 0, receivedAt: 0 }];
    let at = 0;
    for (let i = 1; i <= TIMING_WATERFALL_LIMIT + 1; i += 1) {
      at += 400 + i * 10;
      events.push({ index: i, receivedAt: at });
    }
    const stalls = scanStreamAnomalies(record(events, "many")).filter(
      (item) => item.kind === "stall",
    );
    expect(stalls).toHaveLength(TIMING_WATERFALL_LIMIT);
    expect(stalls[0]?.eventIndex).toBe(TIMING_WATERFALL_LIMIT + 1);
    expect(stalls.some((item) => item.eventIndex === 1)).toBe(false);
  });
});
