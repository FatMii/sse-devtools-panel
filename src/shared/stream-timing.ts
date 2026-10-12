import type { SseEvent, StreamReconnectMark } from "./types";

export type GapSample = {
  /** Gap before this event (event[i] - event[i-1]), i >= 1 */
  afterIndex: number;
  gapMs: number;
};

export type TimelineInsight =
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

export type TimelineMark = {
  index: number;
  event: string;
  /** Offset from timeline origin (ms) */
  offsetMs: number;
  /** Gap from previous event; undefined for first */
  gapFromPrevMs?: number;
};

/** Default gap histogram edges (ms). Last bin is open-ended. */
export const DEFAULT_GAP_BIN_EDGES_MS = [0, 10, 25, 50, 100, 250, 500, 1000] as const;

/** Gap ≥ this is a stall (red tick / KPI alert). */
export const TIMELINE_STALL_MS = 400;

/** Histogram bins with fromMs ≥ this are "hot" (longer stalls). */
export const TIMELINE_HOT_GAP_MS = 400;

export function isStallGapMs(gapMs: number | undefined | null): boolean {
  return typeof gapMs === "number" && Number.isFinite(gapMs) && gapMs >= TIMELINE_STALL_MS;
}

export function isHotGapBinFromMs(fromMs: number): boolean {
  return Number.isFinite(fromMs) && fromMs >= TIMELINE_HOT_GAP_MS;
}

/** True if the bin range overlaps hot/stall waits (includes open-ended last bin). */
export function isHotGapBin(bin: Pick<HistogramBin, "fromMs" | "toMs">): boolean {
  if (bin.fromMs >= TIMELINE_HOT_GAP_MS) return true;
  return bin.toMs > TIMELINE_HOT_GAP_MS;
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

export function buildTimelineMarks(
  events: Array<Pick<SseEvent, "index" | "event" | "receivedAt">>,
  originMs?: number,
): TimelineMark[] {
  if (events.length === 0) return [];
  const origin = originMs ?? events[0].receivedAt;
  return events.map((ev, i) => {
    const mark: TimelineMark = {
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

export function timelineSpanMs(marks: Array<Pick<TimelineMark, "offsetMs">>): number {
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
 * Merge top stalls + reconnects for the Insights list.
 * Order: stalls by gap desc, then reconnects by count desc (newest first).
 */
export function buildTimelineInsights(input: {
  gaps: GapSample[];
  events: Array<Pick<SseEvent, "index" | "event" | "receivedAt" | "id">>;
  reconnects: StreamReconnectMark[];
  originMs: number;
  stallLimit?: number;
}): TimelineInsight[] {
  const stallLimit = input.stallLimit ?? 5;
  const byIndex = new Map(input.events.map((ev) => [ev.index, ev]));
  const stalls = largestGaps(input.gaps, stallLimit).map((gap, i) => {
    const insight: TimelineInsight = {
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
      const insight: TimelineInsight = {
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
  marks: Array<Pick<TimelineMark, "index" | "offsetMs" | "gapFromPrevMs">>,
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

/** Visible time window on the arrival track (offsets from stream origin). */
export type TimelineViewWindow = {
  startMs: number;
  endMs: number;
};

/** Smallest arrival-track window; lower = allow deeper zoom-in. */
export const TIMELINE_MIN_VIEW_MS = 50;

export function fitTimelineView(spanMs: number): TimelineViewWindow {
  return { startMs: 0, endMs: Math.max(1, spanMs) };
}

export function clampTimelineView(
  view: TimelineViewWindow,
  spanMs: number,
  minWindowMs = TIMELINE_MIN_VIEW_MS,
): TimelineViewWindow {
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
export function zoomTimelineView(
  view: TimelineViewWindow,
  spanMs: number,
  factor: number,
  anchorRatio = 0.5,
  minWindowMs = TIMELINE_MIN_VIEW_MS,
): TimelineViewWindow {
  const cur = Math.max(1, view.endMs - view.startMs);
  const ratio = Math.min(1, Math.max(0, anchorRatio));
  const anchor = view.startMs + ratio * cur;
  const nextWindow = Math.min(Math.max(spanMs, 1), Math.max(minWindowMs, cur * factor));
  const startMs = anchor - ratio * nextWindow;
  return clampTimelineView({ startMs, endMs: startMs + nextWindow }, spanMs, minWindowMs);
}

export function panTimelineView(
  view: TimelineViewWindow,
  spanMs: number,
  deltaMs: number,
  minWindowMs = TIMELINE_MIN_VIEW_MS,
): TimelineViewWindow {
  return clampTimelineView(
    { startMs: view.startMs + deltaMs, endMs: view.endMs + deltaMs },
    spanMs,
    minWindowMs,
  );
}

/** Session narrative phases along the arrival timeline (canvas band fill). */
export type TimelinePhaseKind = "ttft" | "steady" | "stall" | "done";

export type TimelinePhaseSegment = {
  kind: TimelinePhaseKind;
  startMs: number;
  endMs: number;
};

/**
 * Split the stream into TTFT → steady/stall gaps → optional done tail.
 * TTFT covers [0, first event] (connect wait is included; no separate connect probe).
 * Trailing time after the last event is `done` only when `ended` is true.
 */
export function buildTimelinePhases(input: {
  marks: Array<Pick<TimelineMark, "offsetMs" | "gapFromPrevMs">>;
  spanMs: number;
  ended?: boolean;
  stallMs?: number;
}): TimelinePhaseSegment[] {
  const spanMs = Math.max(1, input.spanMs);
  const stallMs = input.stallMs ?? TIMELINE_STALL_MS;
  const ended = Boolean(input.ended);
  const marks = input.marks;
  const raw: TimelinePhaseSegment[] = [];

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

function mergeAdjacentPhases(segments: TimelinePhaseSegment[]): TimelinePhaseSegment[] {
  const out: TimelinePhaseSegment[] = [];
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
  marks: Array<Pick<TimelineMark, "index" | "offsetMs">>,
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
