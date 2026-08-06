import type { StreamMetrics, StreamRecord } from "../shared/types";

export function computeStreamMetrics(record: StreamRecord): StreamMetrics {
  const events = record.events;
  const firstTs = events[0]?.receivedAt;
  const endedAt = record.endedAt;
  const durationMs =
    typeof endedAt === "number" && endedAt >= record.startedAt
      ? endedAt - record.startedAt
      : undefined;
  const ttftMs = typeof firstTs === "number" ? Math.max(0, firstTs - record.startedAt) : undefined;
  const gaps: number[] = [];
  for (let i = 1; i < events.length; i += 1) {
    const gap = events[i].receivedAt - events[i - 1].receivedAt;
    if (Number.isFinite(gap) && gap >= 0) gaps.push(gap);
  }
  const avgGapMs =
    gaps.length > 0 ? gaps.reduce((sum, ms) => sum + ms, 0) / gaps.length : undefined;
  const p95GapMs =
    gaps.length > 0
      ? [...gaps].sort((a, b) => a - b)[Math.max(0, Math.ceil(gaps.length * 0.95) - 1)]
      : undefined;
  const eventsPerSec =
    durationMs && durationMs > 0
      ? Number((events.length / (durationMs / 1000)).toFixed(2))
      : undefined;
  return { ttftMs, durationMs, avgGapMs, p95GapMs, eventsPerSec };
}

export function ensureStreamMetrics(record: StreamRecord): StreamMetrics {
  if (record.metrics) return record.metrics;
  const next = computeStreamMetrics(record);
  record.metrics = next;
  return next;
}
