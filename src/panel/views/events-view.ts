import { t } from "../../shared/i18n";
import { compileTextFilter } from "../../shared/text-filter";
import type { SseEvent, StreamRecord } from "../../shared/types";
import {
  elContextMenu,
  elDrawer,
  elDrawerBody,
  elDrawerNext,
  elDrawerPrev,
  elDrawerTitle,
  elEvents,
  elEventsFilterHint,
  elMenuCopyData,
  elMenuCopyJsonPath,
  elMenuCopyJsonValue,
  elPlaceholder,
  elResizer,
  elTableWrap,
  elTbody,
} from "../core/dom";
import { escapeHtml, formatTime, previewData } from "../core/format";
import { applyTreeSearch, createJsonTree, tryParseJsonValue } from "../widgets/json-tree";
import {
  getStreamSpecWarnings,
  specWarningKindLabel,
  specWarningMessage,
} from "../features/stream-anomalies";
import { state } from "../core/state";
import {
  computeVirtualWindow,
  EVENTS_ROW_HEIGHT_DEFAULT,
  EVENTS_VIRTUAL_OVERSCAN,
  isNearBottom,
} from "./events-virtual";

export const DRAWER_WIDTH_MIN = 20;
export const DRAWER_WIDTH_MAX = 75;
export const DRAWER_WIDTH_DEFAULT = 42;

const COL_COUNT = 4;
const NEAR_BOTTOM_PX = 48;

let browsableEvents: SseEvent[] = [];
let rowHeight = EVENTS_ROW_HEIGHT_DEFAULT;
let scrollListening = false;
let scrollPaintScheduled = false;
/** When true, next paint should pin scroll to bottom after layout. */
let stickToBottomPending = false;

export function eventMatchesSearch(ev: SseEvent, query: string): boolean {
  // Align with Chrome Network EventStream: filter on event type + data payload
  const filter = compileTextFilter(query);
  if (filter.isEmpty) return true;
  return filter.test(ev.event) || filter.test(ev.data);
}

/** Events currently visible under the Events search filter (ordered). */
export function getBrowsableEvents(record: StreamRecord): SseEvent[] {
  return record.events.filter((ev) => eventMatchesSearch(ev, state.eventsSearchQuery));
}

function ensureScrollListener(): void {
  if (scrollListening) return;
  elTableWrap.addEventListener("scroll", onTableScroll, { passive: true });
  scrollListening = true;
}

function teardownScrollListener(): void {
  if (!scrollListening) return;
  elTableWrap.removeEventListener("scroll", onTableScroll);
  scrollListening = false;
  scrollPaintScheduled = false;
}

function onTableScroll(): void {
  if (scrollPaintScheduled) return;
  scrollPaintScheduled = true;
  requestAnimationFrame(() => {
    scrollPaintScheduled = false;
    paintVisibleRows();
  });
}

function createSpacerRow(kind: "top" | "bottom", heightPx: number): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = `virtual-spacer virtual-spacer-${kind}`;
  tr.setAttribute("aria-hidden", "true");
  const td = document.createElement("td");
  td.colSpan = COL_COUNT;
  td.style.height = `${Math.max(0, heightPx)}px`;
  td.style.padding = "0";
  td.style.border = "0";
  tr.appendChild(td);
  return tr;
}

function measureRowHeight(sample: HTMLTableRowElement): void {
  const h = sample.getBoundingClientRect().height;
  if (h > 0) rowHeight = h;
}

function updateFilterHint(record: StreamRecord, visible: number): void {
  if (!elEventsFilterHint) return;
  if (record.events.length > 0) {
    elEventsFilterHint.hidden = false;
    elEventsFilterHint.textContent = t("eventsFilterHint", [
      String(visible),
      String(record.events.length),
    ]);
  } else {
    elEventsFilterHint.hidden = true;
    elEventsFilterHint.textContent = "";
  }
}

function refreshBrowsable(record: StreamRecord): void {
  browsableEvents = getBrowsableEvents(record);
  updateFilterHint(record, browsableEvents.length);

  if (record.events.length > 0 && browsableEvents.length === 0 && state.eventsSearchQuery.trim()) {
    elPlaceholder.hidden = false;
    elPlaceholder.textContent = t("noEventsMatch");
  } else if (record.events.length > 0) {
    elPlaceholder.hidden = true;
  }
}

function paintVisibleRows(): void {
  const total = browsableEvents.length;
  if (total === 0) {
    elTbody.replaceChildren();
    return;
  }

  const wrap = elTableWrap;
  const win = computeVirtualWindow({
    scrollTop: wrap.scrollTop,
    viewportHeight: wrap.clientHeight,
    rowHeight,
    total,
    overscan: EVENTS_VIRTUAL_OVERSCAN,
  });

  const frag = document.createDocumentFragment();
  if (win.paddingTop > 0) {
    frag.appendChild(createSpacerRow("top", win.paddingTop));
  }
  for (let i = win.start; i < win.end; i++) {
    frag.appendChild(createEventRow(browsableEvents[i]));
  }
  if (win.paddingBottom > 0) {
    frag.appendChild(createSpacerRow("bottom", win.paddingBottom));
  }
  elTbody.replaceChildren(frag);

  const firstData = elTbody.querySelector<HTMLTableRowElement>("tr[data-index]");
  if (firstData) {
    const prevHeight = rowHeight;
    measureRowHeight(firstData);
    // Spacers used the previous estimate; rebuild once after the first real measure.
    if (Math.abs(rowHeight - prevHeight) >= 1) {
      paintVisibleRows();
      return;
    }
  }

  syncRowSelection();

  if (stickToBottomPending) {
    stickToBottomPending = false;
    wrap.scrollTop = wrap.scrollHeight;
  }
}

function scrollFilteredIndexIntoView(filteredIndex: number, mode: "nearest" | "start"): void {
  const wrap = elTableWrap;
  const thead = wrap.querySelector("thead");
  const headerHeight = thead ? thead.getBoundingClientRect().height : 0;
  const pad = 4;
  const rowTop = filteredIndex * rowHeight;

  if (mode === "start") {
    wrap.scrollTop = Math.max(0, rowTop - pad);
    paintVisibleRows();
    return;
  }

  const viewTop = wrap.scrollTop;
  const viewBottom = viewTop + wrap.clientHeight - headerHeight;
  const rowBottom = rowTop + rowHeight;

  if (rowTop < viewTop + pad) {
    wrap.scrollTop = Math.max(0, rowTop - pad);
  } else if (rowBottom > viewBottom - pad) {
    wrap.scrollTop = Math.max(0, rowBottom - (wrap.clientHeight - headerHeight) + pad);
  }
  paintVisibleRows();
}

export function scrollEventRowIntoView(row: HTMLTableRowElement, mode: "nearest" | "start"): void {
  const indexAttr = row.getAttribute("data-index");
  if (indexAttr == null) return;
  const eventIndex = Number(indexAttr);
  const filteredIndex = browsableEvents.findIndex((ev) => ev.index === eventIndex);
  if (filteredIndex === -1) return;
  scrollFilteredIndexIntoView(filteredIndex, mode);
}

export function selectEventByIndex(
  record: StreamRecord,
  index: number,
  options?: { scrollMode?: "nearest" | "start" },
): void {
  const ev = record.events.find((e) => e.index === index);
  if (!ev) return;
  state.selectedEventIndex = index;
  openDrawer(ev);

  const filteredIndex = browsableEvents.findIndex((e) => e.index === index);
  if (filteredIndex !== -1) {
    scrollFilteredIndexIntoView(filteredIndex, options?.scrollMode ?? "nearest");
  } else {
    syncRowSelection();
  }
}

export function navigateDrawer(offset: -1 | 1): void {
  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
  if (!record || state.selectedEventIndex == null) return;

  const browsable = getBrowsableEvents(record);
  if (browsable.length === 0) return;

  const pos = browsable.findIndex((ev) => ev.index === state.selectedEventIndex);
  if (pos === -1) return;

  const nextPos = pos + offset;
  if (nextPos < 0 || nextPos >= browsable.length) return;
  selectEventByIndex(record, browsable[nextPos].index);
}

export function updateDrawerNavButtons(): void {
  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
  if (!record || state.selectedEventIndex == null || elDrawer.hidden) {
    elDrawerPrev.disabled = true;
    elDrawerNext.disabled = true;
    return;
  }

  const browsable = getBrowsableEvents(record);
  const pos = browsable.findIndex((ev) => ev.index === state.selectedEventIndex);
  elDrawerPrev.disabled = pos <= 0;
  elDrawerNext.disabled = pos === -1 || pos >= browsable.length - 1;
}

export function renderEvents(record: StreamRecord, appendFriendly: boolean): void {
  if (record.events.length === 0) {
    browsableEvents = [];
    stickToBottomPending = false;
    teardownScrollListener();
    elPlaceholder.hidden = false;
    elPlaceholder.textContent = t("noEventsYet");
    elTableWrap.hidden = true;
    elTbody.replaceChildren();
    if (elEventsFilterHint) {
      elEventsFilterHint.hidden = true;
      elEventsFilterHint.textContent = "";
    }
    closeDrawer();
    return;
  }

  elPlaceholder.hidden = true;
  elTableWrap.hidden = false;
  ensureScrollListener();
  refreshBrowsable(record);

  const wasNearBottom = isNearBottom(
    elTableWrap.scrollTop,
    elTableWrap.scrollHeight,
    elTableWrap.clientHeight,
    NEAR_BOTTOM_PX,
  );
  const shouldStick =
    state.activeTab === "events" &&
    appendFriendly &&
    !state.eventsSearchQuery.trim() &&
    (wasNearBottom || elTableWrap.scrollHeight <= elTableWrap.clientHeight + 1);

  stickToBottomPending = shouldStick;
  paintVisibleRows();

  if (state.selectedEventIndex != null) {
    const ev = record.events.find((e) => e.index === state.selectedEventIndex);
    if (ev) {
      openDrawer(ev);
    } else {
      closeDrawer();
    }
  } else {
    closeDrawer();
  }
}

export function applyEventsFilter(): void {
  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
  if (!record) return;

  refreshBrowsable(record);
  stickToBottomPending = false;
  if (record.events.length === 0) {
    elTbody.replaceChildren();
    return;
  }
  elTableWrap.hidden = false;
  ensureScrollListener();
  // Keep scroll position when filtering; clamp if list shrank.
  const maxScroll = Math.max(0, browsableEvents.length * rowHeight - elTableWrap.clientHeight);
  if (elTableWrap.scrollTop > maxScroll) {
    elTableWrap.scrollTop = maxScroll;
  }
  paintVisibleRows();
}

export function createEventRow(ev: SseEvent): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.dataset.index = String(ev.index);
  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
  const eventWarnings =
    record && record.streamKind === "sse"
      ? getStreamSpecWarnings(record).filter((w) => w.eventIndex === ev.index)
      : [];
  const warnMark =
    eventWarnings.length > 0
      ? `<span class="event-spec-mark" title="${escapeHtml(
          eventWarnings.map((w) => specWarningKindLabel(w.kind)).join(", "),
        )}">S</span>`
      : "";
  tr.innerHTML = `
    <td class="col-index col-n">${ev.index}${warnMark}</td>
    <td class="col-time">${escapeHtml(formatTime(ev.receivedAt))}</td>
    <td class="col-event">${escapeHtml(ev.event)}</td>
    <td class="col-data data-cell" title="${escapeHtml(ev.data)}">${escapeHtml(previewData(ev.data))}</td>
  `;
  tr.addEventListener("click", () => {
    hideContextMenu();
    if (state.selectedEventIndex === ev.index) {
      state.selectedEventIndex = null;
      closeDrawer();
      syncRowSelection();
      return;
    }
    state.selectedEventIndex = ev.index;
    syncRowSelection();
    openDrawer(ev);
  });
  tr.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, ev.data);
  });
  return tr;
}

export function showContextMenu(x: number, y: number, data: string): void {
  state.contextMenuData = { kind: "event-data", data };
  if (elMenuCopyData) elMenuCopyData.hidden = false;
  if (elMenuCopyJsonValue) elMenuCopyJsonValue.hidden = true;
  if (elMenuCopyJsonPath) elMenuCopyJsonPath.hidden = true;
  elContextMenu.hidden = false;
  const pad = 4;
  const menuW = elContextMenu.offsetWidth || 140;
  const menuH = elContextMenu.offsetHeight || 36;
  const left = Math.min(x, window.innerWidth - menuW - pad);
  const top = Math.min(y, window.innerHeight - menuH - pad);
  elContextMenu.style.left = `${Math.max(pad, left)}px`;
  elContextMenu.style.top = `${Math.max(pad, top)}px`;
}

export function showJsonTreeContextMenu(x: number, y: number, path: string, value?: string): void {
  state.contextMenuData = { kind: "json-node", path, value };
  if (elMenuCopyData) elMenuCopyData.hidden = true;
  if (elMenuCopyJsonValue) elMenuCopyJsonValue.hidden = value == null;
  if (elMenuCopyJsonPath) elMenuCopyJsonPath.hidden = false;
  elContextMenu.hidden = false;
  const pad = 4;
  const menuW = elContextMenu.offsetWidth || 180;
  const menuH = elContextMenu.offsetHeight || 72;
  const left = Math.min(x, window.innerWidth - menuW - pad);
  const top = Math.min(y, window.innerHeight - menuH - pad);
  elContextMenu.style.left = `${Math.max(pad, left)}px`;
  elContextMenu.style.top = `${Math.max(pad, top)}px`;
}

export function hideContextMenu(): void {
  elContextMenu.hidden = true;
  state.contextMenuData = null;
}

export function bindJsonTreeContextMenu(tree: HTMLElement): void {
  tree.addEventListener("json-tree-contextmenu", (event) => {
    const e = event as CustomEvent<{ x: number; y: number; path: string; copyValue?: string }>;
    showJsonTreeContextMenu(e.detail.x, e.detail.y, e.detail.path, e.detail.copyValue);
  });
}

export function syncRowSelection(): void {
  elTbody.querySelectorAll("tr[data-index]").forEach((tr) => {
    const idx = Number(tr.getAttribute("data-index"));
    tr.classList.toggle("selected", idx === state.selectedEventIndex);
  });
}

export function applyDrawerWidth(): void {
  elEvents.style.setProperty("--events-drawer-width", `${state.drawerWidthPercent}%`);
}

export function openDrawer(ev: SseEvent): void {
  const sameEvent = state.drawerEventIndex === ev.index && !elDrawer.hidden;
  elDrawer.hidden = false;
  elResizer.hidden = false;
  elEvents.classList.add("drawer-open");
  applyDrawerWidth();
  state.drawerEventData = ev.data;
  state.drawerEventIndex = ev.index;
  elDrawerTitle.textContent = t("drawerEventTitle", [String(ev.index), ev.event]);
  updateDrawerNavButtons();

  // Avoid wiping drawer search / rebuild when streaming updates the same open event
  if (sameEvent && elDrawerBody.querySelector(".json-tree, .event-body-text")) {
    applyDrawerSearch();
    return;
  }

  elDrawerBody.innerHTML = "";

  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
  const eventWarnings =
    record && record.streamKind === "sse"
      ? getStreamSpecWarnings(record).filter((w) => w.eventIndex === ev.index)
      : [];
  if (eventWarnings.length > 0) {
    const box = document.createElement("div");
    box.className = "drawer-spec-warnings";
    const title = document.createElement("div");
    title.className = "drawer-spec-title";
    title.textContent = t("specWarningsCount", String(eventWarnings.length));
    box.appendChild(title);
    const ul = document.createElement("ul");
    for (const warning of eventWarnings) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(specWarningKindLabel(warning.kind))}</strong> — ${escapeHtml(
        specWarningMessage(warning),
      )}`;
      ul.appendChild(li);
    }
    box.appendChild(ul);
    elDrawerBody.appendChild(box);
  }

  const parsed = tryParseJsonValue(ev.data);
  if (parsed.ok) {
    const tree = createJsonTree(parsed.value, { defaultExpandDepth: 2 });
    bindJsonTreeContextMenu(tree);
    elDrawerBody.appendChild(tree);
  } else {
    const pre = document.createElement("pre");
    pre.className = "event-body-text";
    pre.textContent = ev.data;
    elDrawerBody.appendChild(pre);
  }
  applyDrawerSearch();
}

export function applyDrawerSearch(): void {
  const tree = elDrawerBody.querySelector<HTMLElement>(".json-tree");
  if (tree) {
    applyTreeSearch(tree, state.drawerSearchQuery);
    return;
  }

  const pre = elDrawerBody.querySelector<HTMLPreElement>(".event-body-text");
  if (!pre || state.drawerEventData == null) return;

  const filter = compileTextFilter(state.drawerSearchQuery);
  if (filter.isEmpty) {
    pre.textContent = state.drawerEventData;
    pre.classList.remove("search-no-match");
    return;
  }

  if (!filter.test(state.drawerEventData)) {
    pre.textContent = t("noMatches");
    pre.classList.add("search-no-match");
    return;
  }

  pre.classList.remove("search-no-match");
  pre.textContent = "";
  const ranges = filter.matchRanges(state.drawerEventData);
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      pre.appendChild(document.createTextNode(state.drawerEventData.slice(cursor, range.start)));
    }
    const mark = document.createElement("mark");
    mark.className = "search-mark";
    mark.textContent = state.drawerEventData.slice(range.start, range.end);
    pre.appendChild(mark);
    cursor = range.end;
  }
  if (cursor < state.drawerEventData.length) {
    pre.appendChild(document.createTextNode(state.drawerEventData.slice(cursor)));
  }
}

export function closeDrawer(): void {
  state.selectedEventIndex = null;
  state.drawerEventData = null;
  state.drawerEventIndex = null;
  elDrawer.hidden = true;
  elResizer.hidden = true;
  elEvents.classList.remove("drawer-open");
  elDrawerBody.innerHTML = "";
  elDrawerTitle.textContent = "";
  updateDrawerNavButtons();
  syncRowSelection();
}

/** Clear events table UI when no stream is selected. */
export function clearEventsView(): void {
  browsableEvents = [];
  stickToBottomPending = false;
  teardownScrollListener();
  elPlaceholder.hidden = false;
  elPlaceholder.textContent = t("noStreamSelected");
  elTableWrap.hidden = true;
  elTbody.replaceChildren();
  closeDrawer();
  if (elEventsFilterHint) {
    elEventsFilterHint.hidden = true;
    elEventsFilterHint.textContent = "";
  }
}
