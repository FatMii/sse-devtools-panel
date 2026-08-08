/** Soft-wrap + fixed-row virtual window for Conversation text panes. */

export const CONV_ROW_HEIGHT_PX = 18; // 11px * 1.65, matches .conversation-pane
export const CONV_VIRTUAL_OVERSCAN = 16;
/** Mono ~0.6em at 11px; used to estimate columns from viewport width. */
export const CONV_CHAR_WIDTH_PX = 6.6;
export const CONV_PANE_PAD_X_PX = 22; // padding 9 + 11

export type ConvVirtualWindow = {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
};

/**
 * Soft-wrap `text` into display rows using a fixed column width.
 * Matches CSS `word-break: break-word` closely enough for virtualization.
 */
export function wrapTextToRows(text: string, cols: number): string[] {
  const width = Math.max(8, Math.floor(cols));
  const rows: string[] = [];
  if (text.length === 0) return rows;

  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf("\n", i);
    const end = nl === -1 ? text.length : nl;
    const lineLen = end - i;
    if (lineLen === 0) {
      rows.push("");
    } else {
      for (let off = 0; off < lineLen; off += width) {
        rows.push(text.slice(i + off, i + Math.min(off + width, lineLen)));
      }
    }
    if (nl === -1) break;
    i = nl + 1;
    if (i === text.length) rows.push("");
  }
  return rows;
}

export function estimateCols(clientWidth: number): number {
  const inner = Math.max(40, clientWidth - CONV_PANE_PAD_X_PX);
  return Math.max(20, Math.floor(inner / CONV_CHAR_WIDTH_PX));
}

export function computeConvVirtualWindow(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight = CONV_ROW_HEIGHT_PX,
  overscan = CONV_VIRTUAL_OVERSCAN,
): ConvVirtualWindow {
  if (rowCount <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewport = Math.max(0, viewportHeight);
  const start = Math.max(0, Math.floor(safeScrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(safeViewport / rowHeight) + 1;
  const end = Math.min(rowCount, start + visibleCount + overscan * 2);
  return {
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (rowCount - end) * rowHeight),
  };
}

export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx = 48,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - thresholdPx;
}
