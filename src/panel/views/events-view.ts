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

export const DRAWER_WIDTH_MIN = 20;
export const DRAWER_WIDTH_MAX = 75;
export const DRAWER_WIDTH_DEFAULT = 42;

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

export function scrollEventRowIntoView(row: HTMLTableRowElement, mode: "nearest" | "start"): void {
  const wrap = elTableWrap;
  const wrapRect = wrap.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const thead = wrap.querySelector("thead");
  const headerHeight = thead ? thead.getBoundingClientRect().height : 0;
  const pad = 4;

  if (mode === "start") {
    const targetTop = Math.max(0, row.offsetTop - headerHeight - pad);
    wrap.scrollTop = targetTop;
    return;
  }

  const visibleTop = wrapRect.top + headerHeight;
  const visibleBottom = wrapRect.bottom;
  if (rowRect.top < visibleTop) {
    wrap.scrollTop -= visibleTop - rowRect.top + pad;
    return;
  }
  if (rowRect.bottom > visibleBottom) {
    wrap.scrollTop += rowRect.bottom - visibleBottom + pad;
  }
}

export function selectEventByIndex(
  record: StreamRecord,
  index: number,
  options?: { scrollMode?: "nearest" | "start" },
): void {
  const ev = record.events.find((e) => e.index === index);
  if (!ev) return;
  state.selectedEventIndex = index;
  syncRowSelection();
  openDrawer(ev);
  const row = elTbody.querySelector<HTMLTableRowElement>(`tr[data-index="${index}"]`);
  if (row) {
    scrollEventRowIntoView(row, options?.scrollMode ?? "nearest");
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
    elPlaceholder.hidden = false;
    elPlaceholder.textContent = t("noEventsYet");
    elTableWrap.hidden = true;
    elTbody.innerHTML = "";
    if (elEventsFilterHint) {
      elEventsFilterHint.hidden = true;
      elEventsFilterHint.textContent = "";
    }
    closeDrawer();
    return;
  }

  elPlaceholder.hidden = true;
  elTableWrap.hidden = false;

  const existing = elTbody.querySelectorAll("tr").length;
  if (!appendFriendly || existing === 0) {
    elTbody.innerHTML = "";
    for (const ev of record.events) {
      elTbody.appendChild(createEventRow(ev));
    }
  } else {
    for (let i = existing; i < record.events.length; i++) {
      elTbody.appendChild(createEventRow(record.events[i]));
    }
  }

  applyEventsFilter();
  syncRowSelection();

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

  if (state.activeTab === "events" && appendFriendly && !state.eventsSearchQuery.trim()) {
    elTableWrap.scrollTop = elTableWrap.scrollHeight;
  }
}

export function applyEventsFilter(): void {
  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
  if (!record) return;

  let visible = 0;
  elTbody.querySelectorAll("tr").forEach((tr) => {
    const idx = Number(tr.getAttribute("data-index"));
    const ev = record.events.find((e) => e.index === idx);
    const show = ev ? eventMatchesSearch(ev, state.eventsSearchQuery) : false;
    tr.hidden = !show;
    if (show) visible += 1;
  });

  if (elEventsFilterHint) {
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

  if (record.events.length > 0 && visible === 0 && state.eventsSearchQuery.trim()) {
    elPlaceholder.hidden = false;
    elPlaceholder.textContent = t("noEventsMatch");
    // keep table visible so clearing search restores rows without rebuild
  } else if (record.events.length > 0) {
    elPlaceholder.hidden = true;
  }
}

export function createEventRow(ev: SseEvent): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.dataset.index = String(ev.index);
  tr.hidden = !eventMatchesSearch(ev, state.eventsSearchQuery);
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
  elTbody.querySelectorAll("tr").forEach((tr) => {
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
  elDrawerTitle.textContent = `#${ev.index} · ${ev.event}`;
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
  elPlaceholder.hidden = false;
  elPlaceholder.textContent = t("noStreamSelected");
  elTableWrap.hidden = true;
  elTbody.innerHTML = "";
  closeDrawer();
  if (elEventsFilterHint) {
    elEventsFilterHint.hidden = true;
    elEventsFilterHint.textContent = "";
  }
}
