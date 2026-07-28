import type { SseEvent } from "./types";

export type GapSample = {
  /** Gap before this event (event[i] - event[i-1]), i >= 1 */
  afterIndex: number;
  gapMs: number;
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

export function collectEventGaps(events: Array<Pick<SseEvent, "index" | "receivedAt">>): GapSample[] {
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
