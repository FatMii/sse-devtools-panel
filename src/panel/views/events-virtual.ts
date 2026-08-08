/** Fixed-row-height window math for the Events table virtualizer. */

export const EVENTS_ROW_HEIGHT_DEFAULT = 29;
export const EVENTS_VIRTUAL_OVERSCAN = 8;

export type VirtualWindowInput = {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  total: number;
  overscan?: number;
};

export type VirtualWindow = {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
};

/**
 * Compute which [start, end) rows should be mounted for a scroll viewport.
 * `end` is exclusive. Padding heights keep the scrollbar size correct.
 */
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const { scrollTop, viewportHeight, rowHeight, total } = input;
  const overscan = input.overscan ?? EVENTS_VIRTUAL_OVERSCAN;

  if (total <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
  }

  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewport = Math.max(0, viewportHeight);
  const start = Math.max(0, Math.floor(safeScrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(safeViewport / rowHeight) + 1;
  const end = Math.min(total, start + visibleCount + overscan * 2);
  const paddingTop = start * rowHeight;
  const paddingBottom = Math.max(0, (total - end) * rowHeight);

  return { start, end, paddingTop, paddingBottom };
}

/** Whether the viewport is pinned near the bottom (for stick-to-bottom streaming). */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx = 48,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - thresholdPx;
}
