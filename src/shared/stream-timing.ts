import type { SseEvent, StreamReconnectMark } from "./types";

export type GapSample = {
  /** Gap before this event (event[i] - event[i-1]), i >= 1 */
  afterIndex: number;
  gapMs: number;
};

export type TimingInsight =
  | {
      kind: "stall";
      /** 1-based rank among listed stalls (1 = longest). */
      rank: number;
      afterIndex: number;
      gapMs: number;
      eventName?: string;
      jumpIndex: number;
    }
  | {
      kind: "reconnect";
      reconnectCount: number;
      offsetMs: number;
      lastEventId?: string;
      /** Nearest event to jump to; null when the stream has no events yet. */
      jumpIndex: number | null;
    };

export type HistogramBin = {
  /** Inclusive lower bound in ms */
  fromMs: number;
  /** Exclusive upper bound; Infinity for open-ended */
  toMs: number;
  label: string;
  count: number;
};

export type TimingMark = {
  index: number;
  event: string;
  /** Offset from timing origin (ms) */
  offsetMs: number;
  /** Gap from previous event; undefined for first */
  gapFromPrevMs?: number;
};

/** Default gap histogram edges (ms). Last bin is open-ended. */
export const DEFAULT_GAP_BIN_EDGES_MS = [0, 10, 25, 50, 100, 250, 500, 1000] as const;

/** Gap ≥ this is a stall (red tick / KPI alert). */
export const TIMING_STALL_MS = 400;

/** Histogram bins with fromMs ≥ this are "hot" (longer stalls). */
export const TIMING_HOT_GAP_MS = 400;

/** Longest-waits list shows the top N waits by duration. */
export const TIMING_WATERFALL_LIMIT = 10;

/** Gaps ≥ this use the strongest waterfall bar tone. */
export const TIMING_WATERFALL_SEVERE_MS = 1000;

/** Max stall chips pinned on the arrival track. */
export const TIMING_ANOMALY_STALL_LIMIT = 5;

export type TimingAnomaly =
  | {
      kind: "stall";
      offsetMs: number;
      gapMs: number;
      jumpIndex: number;
    }
  | {
      kind: "reconnect";
      offsetMs: number;
      reconnectCount: number;
      jumpIndex: number | null;
    };

/**
 * Pin notable stalls / reconnects on the arrival track.
 * Stalls are capped; reconnects stay complete (usually few).
 */
export function buildTimingAnomalies(input: {
  marks: Array<Pick<TimingMark, "index" | "offsetMs" | "gapFromPrevMs">>;
  reconnects: StreamReconnectMark[];
  originMs: number;
  events: Array<Pick<SseEvent, "index" | "receivedAt" | "id">>;
  stallLimit?: number;
}): TimingAnomaly[] {
  const stallLimit = input.stallLimit ?? TIMING_ANOMALY_STALL_LIMIT;

  const stallMarks = input.marks
    .filter((m) => isStallGapMs(m.gapFromPrevMs))
    .sort((a, b) => (b.gapFromPrevMs ?? 0) - (a.gapFromPrevMs ?? 0))
    .slice(0, Math.max(0, stallLimit));

  const stalls: TimingAnomaly[] = stallMarks.map((m) => ({
    kind: "stall",
    offsetMs: m.offsetMs,
    gapMs: m.gapFromPrevMs ?? 0,
    jumpIndex: m.index,
  }));

  const reconnects: TimingAnomaly[] = [...input.reconnects]
    .sort((a, b) => a.reconnectCount - b.reconnectCount)
    .map((reconnect) => ({
      kind: "reconnect" as const,
      offsetMs: Math.max(0, reconnect.at - input.originMs),
      reconnectCount: reconnect.reconnectCount,
      jumpIndex: findNearestEventIndex(input.events, reconnect.at, reconnect.lastEventId),
    }));

  return [...stalls, ...reconnects];
}

export type WaterfallBarKind = "severe" | "stall" | "ok";

export function waterfallBarKind(gapMs: number): WaterfallBarKind {
  if (!Number.isFinite(gapMs) || gapMs < TIMING_STALL_MS) return "ok";
  if (gapMs >= TIMING_WATERFALL_SEVERE_MS) return "severe";
  return "stall";
}

export function isStallGapMs(gapMs: number | undefined | null): boolean {
  return typeof gapMs === "number" && Number.isFinite(gapMs) && gapMs >= TIMING_STALL_MS;
}

export function isHotGapBinFromMs(fromMs: number): boolean {
  return Number.isFinite(fromMs) && fromMs >= TIMING_HOT_GAP_MS;
}

/** True if the bin range overlaps hot/stall waits (includes open-ended last bin). */
export function isHotGapBin(bin: Pick<HistogramBin, "fromMs" | "toMs">): boolean {
  if (bin.fromMs >= TIMING_HOT_GAP_MS) return true;
  return bin.toMs > TIMING_HOT_GAP_MS;
}

export function gapsInBin(
  gaps: Array<Pick<GapSample, "gapMs" | "afterIndex">>,
  bin: Pick<HistogramBin, "fromMs" | "toMs">,
): GapSample[] {
  return gaps.filter((g) => g.gapMs >= bin.fromMs && g.gapMs < bin.toMs) as GapSample[];
}

export function collectEventGaps(
  events: Array<Pick<SseEvent, "index" | "receivedAt">>,
): GapSample[] {
  const gaps: GapSample[] = [];
  for (let i = 1; i < events.length; i += 1) {
    const gap = events[i].receivedAt - events[i - 1].receivedAt;
    if (!Number.isFinite(gap) || gap < 0) continue;
    gaps.push({ afterIndex: events[i].index, gapMs: gap });
  }
  return gaps;
}

export function buildGapHistogram(
  gaps: Array<Pick<GapSample, "gapMs">>,
  edgesMs: readonly number[] = DEFAULT_GAP_BIN_EDGES_MS,
): HistogramBin[] {
  const edges = [...edgesMs].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (edges.length === 0) {
    return [{ fromMs: 0, toMs: Number.POSITIVE_INFINITY, label: "0+", count: gaps.length }];
  }

  const bins: HistogramBin[] = [];
  for (let i = 0; i < edges.length; i += 1) {
    const fromMs = edges[i];
    const toMs = i + 1 < edges.length ? edges[i + 1] : Number.POSITIVE_INFINITY;
    const label = Number.isFinite(toMs) ? `${fromMs}–${toMs}` : `${fromMs}+`;
    bins.push({ fromMs, toMs, label, count: 0 });
  }

  for (const gap of gaps) {
    const ms = gap.gapMs;
    let placed = false;
    for (const bin of bins) {
      if (ms >= bin.fromMs && ms < bin.toMs) {
        bin.count += 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins[bins.length - 1].count += 1;
    }
  }

  return bins;
}

export function buildTimingMarks(
  events: Array<Pick<SseEvent, "index" | "event" | "receivedAt">>,
  originMs?: number,
): TimingMark[] {
  if (events.length === 0) return [];
  const origin = originMs ?? events[0].receivedAt;
  return events.map((ev, i) => {
    const mark: TimingMark = {
      index: ev.index,
      event: ev.event,
      offsetMs: Math.max(0, ev.receivedAt - origin),
    };
    if (i > 0) {
      const gap = ev.receivedAt - events[i - 1].receivedAt;
      if (Number.isFinite(gap) && gap >= 0) mark.gapFromPrevMs = gap;
    }
    return mark;
  });
}

export function timingSpanMs(marks: Array<Pick<TimingMark, "offsetMs">>): number {
  if (marks.length === 0) return 0;
  let max = 0;
  for (const m of marks) {
    if (m.offsetMs > max) max = m.offsetMs;
  }
  return max;
}

/** Top N largest gaps, descending. */
export function largestGaps(gaps: GapSample[], limit = 5): GapSample[] {
  return [...gaps].sort((a, b) => b.gapMs - a.gapMs).slice(0, Math.max(0, limit));
}

/** Prefer matching Last-Event-ID; otherwise nearest receive time. */
export function findNearestEventIndex(
  events: Array<Pick<SseEvent, "index" | "receivedAt" | "id">>,
  atMs: number,
  lastEventId?: string,
): number | null {
  if (events.length === 0) return null;
  if (lastEventId) {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].id === lastEventId) return events[i].index;
    }
  }
  let bestIndex = events[0].index;
  let bestDist = Math.abs(events[0].receivedAt - atMs);
  for (let i = 1; i < events.length; i += 1) {
    const dist = Math.abs(events[i].receivedAt - atMs);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = events[i].index;
    }
  }
  return bestIndex;
}

/**
 * Ranked waits + reconnects for the silence waterfall.
 * Order: stalls by gap desc, then reconnects by count desc.
 */
export function buildTimingInsights(input: {
  gaps: GapSample[];
  events: Array<Pick<SseEvent, "index" | "event" | "receivedAt" | "id">>;
  reconnects: StreamReconnectMark[];
  originMs: number;
  stallLimit?: number;
}): TimingInsight[] {
  const stallLimit = input.stallLimit ?? TIMING_WATERFALL_LIMIT;
  const byIndex = new Map(input.events.map((ev) => [ev.index, ev]));
  const stalls = largestGaps(input.gaps, stallLimit).map((gap, i) => {
    const insight: TimingInsight = {
      kind: "stall",
      rank: i + 1,
      afterIndex: gap.afterIndex,
      gapMs: gap.gapMs,
      eventName: byIndex.get(gap.afterIndex)?.event,
      jumpIndex: gap.afterIndex,
    };
    return insight;
  });

  const reconnects = [...input.reconnects]
    .sort((a, b) => b.reconnectCount - a.reconnectCount)
    .map((reconnect) => {
      const insight: TimingInsight = {
        kind: "reconnect",
        reconnectCount: reconnect.reconnectCount,
        offsetMs: Math.max(0, reconnect.at - input.originMs),
        lastEventId: reconnect.lastEventId,
        jumpIndex: findNearestEventIndex(input.events, reconnect.at, reconnect.lastEventId),
      };
      return insight;
    });

  return [...stalls, ...reconnects];
}

export type ArrivalLodBucket = {
  count: number;
  stallCount: number;
  /** Prefer latest stall in the bucket; else latest mark. */
  jumpIndex: number | null;
};

/** Pixel-column LOD for the arrival track (one bucket ≈ one CSS pixel). */
export function aggregateArrivalLod(
  marks: Array<Pick<TimingMark, "index" | "offsetMs" | "gapFromPrevMs">>,
  plotWidthPx: number,
  viewStartMs = 0,
  viewEndMs?: number,
): { buckets: ArrivalLodBucket[]; maxCount: number } {
  const endMs =
    typeof viewEndMs === "number" && Number.isFinite(viewEndMs)
      ? viewEndMs
      : marks.reduce((max, m) => (m.offsetMs > max ? m.offsetMs : max), viewStartMs);
  const span = Math.max(1, endMs - viewStartMs);
  const n = Math.max(1, Math.floor(plotWidthPx));
  const buckets: ArrivalLodBucket[] = [];
  for (let i = 0; i < n; i += 1) {
    buckets.push({ count: 0, stallCount: 0, jumpIndex: null });
  }

  let maxCount = 0;
  for (const mark of marks) {
    if (mark.offsetMs < viewStartMs || mark.offsetMs > endMs) continue;
    const x = ((mark.offsetMs - viewStartMs) / span) * n;
    const bi = Math.min(n - 1, Math.max(0, Math.floor(x)));
    const bucket = buckets[bi];
    bucket.count += 1;
    if (isStallGapMs(mark.gapFromPrevMs)) {
      bucket.stallCount += 1;
      bucket.jumpIndex = mark.index;
    } else if (bucket.stallCount === 0) {
      bucket.jumpIndex = mark.index;
    }
    if (bucket.count > maxCount) maxCount = bucket.count;
  }

  return { buckets, maxCount: Math.max(1, maxCount) };
}

export type ArrivalWaitSeries = {
  /** Wait duration (ms) covering each time bucket — same unit as KPI max gap. */
  waitsMs: number[];
  maxWaitMs: number;
  bucketCount: number;
};

/**
 * For each time bucket in [viewStartMs, viewEndMs], take the longest inter-event
 * wait whose interval overlaps that bucket. Y unit is milliseconds (not events/s).
 */
export function buildArrivalWaitSeries(
  marks: Array<Pick<TimingMark, "offsetMs" | "gapFromPrevMs">>,
  viewStartMs: number,
  viewEndMs: number,
  bucketCount: number,
): ArrivalWaitSeries {
  const n = Math.max(1, Math.floor(bucketCount));
  const span = Math.max(1, viewEndMs - viewStartMs);
  const waitsMs = new Array<number>(n).fill(0);

  for (const mark of marks) {
    const gap = mark.gapFromPrevMs;
    if (typeof gap !== "number" || !Number.isFinite(gap) || gap <= 0) continue;
    const waitEnd = mark.offsetMs;
    const waitStart = mark.offsetMs - gap;
    if (waitEnd < viewStartMs || waitStart > viewEndMs) continue;
    const bi0 = Math.floor(((Math.max(waitStart, viewStartMs) - viewStartMs) / span) * n);
    const bi1 = Math.floor(((Math.min(waitEnd, viewEndMs) - viewStartMs) / span) * n);
    for (let bi = Math.max(0, bi0); bi <= Math.min(n - 1, bi1); bi += 1) {
      if (gap > waitsMs[bi]) waitsMs[bi] = gap;
    }
  }

  let maxWaitMs = 0;
  for (const wait of waitsMs) {
    if (wait > maxWaitMs) maxWaitMs = wait;
  }
  return { waitsMs, maxWaitMs: Math.max(maxWaitMs, 1), bucketCount: n };
}

/** Visible time window on the arrival track (offsets from stream origin). */
export type TimingViewWindow = {
  startMs: number;
  endMs: number;
};

/** Smallest arrival-track window; lower = allow deeper zoom-in. */
export const TIMING_MIN_VIEW_MS = 50;

export function fitTimingView(spanMs: number): TimingViewWindow {
  return { startMs: 0, endMs: Math.max(1, spanMs) };
}

export function clampTimingView(
  view: TimingViewWindow,
  spanMs: number,
  minWindowMs = TIMING_MIN_VIEW_MS,
): TimingViewWindow {
  const span = Math.max(1, spanMs);
  const minWin = Math.min(span, Math.max(1, minWindowMs));
  const windowMs = Math.min(span, Math.max(minWin, view.endMs - view.startMs));
  let startMs = view.startMs;
  let endMs = startMs + windowMs;
  if (startMs < 0) {
    startMs = 0;
    endMs = windowMs;
  }
  if (endMs > span) {
    endMs = span;
    startMs = Math.max(0, endMs - windowMs);
  }
  return { startMs, endMs };
}

/** Zoom around an anchor ratio within the current window (0 = left, 1 = right). */
export function zoomTimingView(
  view: TimingViewWindow,
  spanMs: number,
  factor: number,
  anchorRatio = 0.5,
  minWindowMs = TIMING_MIN_VIEW_MS,
): TimingViewWindow {
  const cur = Math.max(1, view.endMs - view.startMs);
  const ratio = Math.min(1, Math.max(0, anchorRatio));
  const anchor = view.startMs + ratio * cur;
  const nextWindow = Math.min(Math.max(spanMs, 1), Math.max(minWindowMs, cur * factor));
  const startMs = anchor - ratio * nextWindow;
  return clampTimingView({ startMs, endMs: startMs + nextWindow }, spanMs, minWindowMs);
}

export function panTimingView(
  view: TimingViewWindow,
  spanMs: number,
  deltaMs: number,
  minWindowMs = TIMING_MIN_VIEW_MS,
): TimingViewWindow {
  return clampTimingView(
    { startMs: view.startMs + deltaMs, endMs: view.endMs + deltaMs },
    spanMs,
    minWindowMs,
  );
}

/** Session narrative phases along the arrival timing (canvas band fill). */
export type TimingPhaseKind = "ttft" | "steady" | "stall" | "done";

export type TimingPhaseSegment = {
  kind: TimingPhaseKind;
  startMs: number;
  endMs: number;
};

/**
 * Split the stream into TTFT → steady/stall gaps → optional done tail.
 * TTFT covers [0, first event] (connect wait is included; no separate connect probe).
 * Trailing time after the last event is `done` only when `ended` is true.
 */
export function buildTimingPhases(input: {
  marks: Array<Pick<TimingMark, "offsetMs" | "gapFromPrevMs">>;
  spanMs: number;
  ended?: boolean;
  stallMs?: number;
}): TimingPhaseSegment[] {
  const spanMs = Math.max(1, input.spanMs);
  const stallMs = input.stallMs ?? TIMING_STALL_MS;
  const ended = Boolean(input.ended);
  const marks = input.marks;
  const raw: TimingPhaseSegment[] = [];

  if (marks.length === 0) {
    raw.push({ kind: ended ? "done" : "ttft", startMs: 0, endMs: spanMs });
  } else {
    const first = marks[0];
    if (first.offsetMs > 0) {
      raw.push({ kind: "ttft", startMs: 0, endMs: first.offsetMs });
    }

    for (let i = 1; i < marks.length; i += 1) {
      const prev = marks[i - 1];
      const cur = marks[i];
      if (cur.offsetMs <= prev.offsetMs) continue;
      const gap = cur.gapFromPrevMs ?? cur.offsetMs - prev.offsetMs;
      raw.push({
        kind: gap >= stallMs ? "stall" : "steady",
        startMs: prev.offsetMs,
        endMs: cur.offsetMs,
      });
    }

    const last = marks[marks.length - 1];
    if (ended && last.offsetMs < spanMs) {
      raw.push({ kind: "done", startMs: last.offsetMs, endMs: spanMs });
    }
  }

  return mergeAdjacentPhases(raw);
}

function mergeAdjacentPhases(segments: TimingPhaseSegment[]): TimingPhaseSegment[] {
  const out: TimingPhaseSegment[] = [];
  for (const seg of segments) {
    if (seg.endMs <= seg.startMs) continue;
    const prev = out[out.length - 1];
    if (prev && prev.kind === seg.kind && prev.endMs === seg.startMs) {
      prev.endMs = seg.endMs;
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}

/** Map a plot-local X coordinate to the nearest in-view mark index. */
export function hitTestArrivalMark(
  marks: Array<Pick<TimingMark, "index" | "offsetMs">>,
  plotX: number,
  plotWidthPx: number,
  viewStartMs: number,
  viewEndMs: number,
  maxDistancePx = Number.POSITIVE_INFINITY,
): number | null {
  if (marks.length === 0 || plotWidthPx <= 0 || !Number.isFinite(plotX)) return null;
  const span = Math.max(1, viewEndMs - viewStartMs);
  let bestIndex: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const mark of marks) {
    if (mark.offsetMs < viewStartMs || mark.offsetMs > viewEndMs) continue;
    const x = ((mark.offsetMs - viewStartMs) / span) * plotWidthPx;
    const dist = Math.abs(x - plotX);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = mark.index;
    }
  }
  if (bestIndex == null || bestDist > maxDistancePx) return null;
  return bestIndex;
}

/** Preferred lane order when those event types are present. */
export const TIMING_LANE_PREFERRED_TYPES = ["message", "delta", "ping", "error"] as const;

/** Cap swimlane rows so exotic streams stay readable. */
export const TIMING_LANE_MAX = 8;

/** Empty / blank SSE `event:` fields render as the default message type. */
export function normalizeTimingEventType(event: string | undefined | null): string {
  const raw = typeof event === "string" ? event.trim() : "";
  return raw.length > 0 ? raw : "message";
}

/**
 * Distinct event types for swimlanes: preferred types first (if present),
 * then remaining by frequency (desc) / name. Capped at TIMING_LANE_MAX.
 */
export function collectTimingLaneTypes(
  marks: Array<Pick<TimingMark, "event">>,
  preferred: readonly string[] = TIMING_LANE_PREFERRED_TYPES,
  maxLanes = TIMING_LANE_MAX,
): string[] {
  const counts = new Map<string, number>();
  for (const m of marks) {
    const type = normalizeTimingEventType(m.event);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const preferredPresent: string[] = [];
  for (const p of preferred) {
    if (counts.has(p)) preferredPresent.push(p);
  }
  const rest = [...counts.keys()]
    .filter((type) => !preferredPresent.includes(type))
    .sort((a, b) => {
      const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
  const ordered = [...preferredPresent, ...rest];
  const limit = Math.max(1, maxLanes);
  if (ordered.length <= limit) return ordered;
  return ordered.slice(0, limit);
}

/** Hit-test within one event-type lane (same X mapping as the arrival track). */
export function hitTestTimingLaneMark(
  marks: Array<Pick<TimingMark, "index" | "offsetMs" | "event">>,
  eventType: string,
  plotX: number,
  plotWidthPx: number,
  viewStartMs: number,
  viewEndMs: number,
  maxDistancePx = 16,
): number | null {
  const filtered = marks.filter((m) => normalizeTimingEventType(m.event) === eventType);
  return hitTestArrivalMark(
    filtered,
    plotX,
    plotWidthPx,
    viewStartMs,
    viewEndMs,
    maxDistancePx,
  );
}
