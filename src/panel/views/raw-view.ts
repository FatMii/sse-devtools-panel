import { elRaw } from "../core/dom";
import { planTextPaneUpdate } from "./conversation-text";
import {
  CONV_ROW_HEIGHT_PX,
  computeConvVirtualWindow,
  estimateCols,
  isNearBottom,
  wrapTextToRows,
} from "./conversation-virtual";

let lastRawStreamId: string | null = null;
let lastRawShown = "";
let rawRows: string[] = [];
let rawCols = 80;
let paintedStart = -1;
let paintedEnd = -1;
let topSpacer: HTMLElement | null = null;
let windowEl: HTMLElement | null = null;
let bottomSpacer: HTMLElement | null = null;
let structureReady = false;
let resizeObserver: ResizeObserver | null = null;

function ensureStructure(): void {
  if (structureReady && topSpacer && windowEl && bottomSpacer) return;
  elRaw.classList.add("raw-virtual-pane");
  elRaw.replaceChildren();
  topSpacer = document.createElement("div");
  topSpacer.className = "raw-virtual-spacer";
  windowEl = document.createElement("pre");
  windowEl.className = "raw-virtual-window";
  bottomSpacer = document.createElement("div");
  bottomSpacer.className = "raw-virtual-spacer";
  elRaw.append(topSpacer, windowEl, bottomSpacer);
  elRaw.addEventListener("scroll", onRawScroll, { passive: true });
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      if (!lastRawShown) {
        paintRawWindow(true);
        return;
      }
      const nextCols = estimateCols(elRaw.clientWidth || 0);
      if (nextCols === rawCols) {
        paintRawWindow(true);
        return;
      }
      const near = isNearBottom(elRaw.scrollTop, elRaw.scrollHeight, elRaw.clientHeight);
      rawCols = nextCols;
      rawRows = wrapTextToRows(lastRawShown, nextCols);
      paintedStart = -1;
      paintRawWindow(true);
      if (near) elRaw.scrollTop = elRaw.scrollHeight;
    });
    resizeObserver.observe(elRaw);
  }
  structureReady = true;
}

function onRawScroll(): void {
  // Preserve scroll position across spacer rewrites (Chrome scroll anchoring).
  const pinnedScrollTop = elRaw.scrollTop;
  paintRawWindow(false);
  if (elRaw.scrollTop !== pinnedScrollTop) {
    elRaw.scrollTop = pinnedScrollTop;
  }
}

function paintRawWindow(force: boolean): void {
  ensureStructure();
  if (!topSpacer || !windowEl || !bottomSpacer) return;
  if (!lastRawShown) {
    topSpacer.style.height = "0px";
    bottomSpacer.style.height = "0px";
    windowEl.textContent = "";
    windowEl.style.height = "0px";
    paintedStart = 0;
    paintedEnd = 0;
    return;
  }
  const win = computeConvVirtualWindow(elRaw.scrollTop, elRaw.clientHeight || 1, rawRows.length);
  const expectedWinH = Math.max(0, win.end - win.start) * CONV_ROW_HEIGHT_PX;
  if (!force && win.start === paintedStart && win.end === paintedEnd) {
    topSpacer.style.height = `${win.paddingTop}px`;
    bottomSpacer.style.height = `${win.paddingBottom}px`;
    windowEl.style.height = `${expectedWinH}px`;
    return;
  }
  topSpacer.style.height = `${win.paddingTop}px`;
  bottomSpacer.style.height = `${win.paddingBottom}px`;
  windowEl.textContent = rawRows.slice(win.start, win.end).join("\n");
  // Lock window box to ideal row geometry so spacer+window never oscillates scrollHeight.
  windowEl.style.height = `${expectedWinH}px`;
  paintedStart = win.start;
  paintedEnd = win.end;
}

export function resetRawView(): void {
  lastRawStreamId = null;
  lastRawShown = "";
  rawRows = [];
  paintedStart = -1;
  paintedEnd = -1;
  if (structureReady) {
    paintRawWindow(true);
  } else {
    elRaw.textContent = "";
  }
}

/** Sync Raw pane from stream record. Call only when Raw tab is active (or clearing). */
export function renderRawView(
  record: { requestId: string; raw: string } | undefined,
  options?: { stickToBottom?: boolean },
): void {
  if (!record) {
    resetRawView();
    return;
  }

  ensureStructure();

  const stick = options?.stickToBottom !== false;
  const nearBottom = isNearBottom(elRaw.scrollTop, elRaw.scrollHeight, elRaw.clientHeight);
  const sameStream = lastRawStreamId === record.requestId;
  const plan =
    sameStream && lastRawShown.length > 0
      ? planTextPaneUpdate(lastRawShown, record.raw)
      : ({ mode: "replace", text: record.raw } as const);

  if (plan.mode === "noop") {
    lastRawStreamId = record.requestId;
    return;
  }

  rawCols = estimateCols(elRaw.clientWidth || 0);
  lastRawStreamId = record.requestId;
  lastRawShown = record.raw;
  rawRows = wrapTextToRows(record.raw, rawCols);
  paintedStart = -1;
  paintRawWindow(true);

  if (stick && (nearBottom || !sameStream || plan.mode === "replace")) {
    elRaw.scrollTop = elRaw.scrollHeight;
  }
}
