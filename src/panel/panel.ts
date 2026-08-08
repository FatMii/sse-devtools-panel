import "./panel.css";
import { applyIcons } from "./core/icons";
import {
  PANEL_PORT,
  type RelayMessage,
  type SseEvent,
  type StreamChunkPayload,
  type StreamEndPayload,
  type StreamErrorPayload,
  type StreamKind,
  type StreamRecord,
  type StreamReconnectPayload,
  type StreamStartPayload,
} from "../shared/types";
import {
  applyDomI18n,
  getActiveLocale,
  initI18n,
  onLocaleChange,
  t,
  uiLanguage,
} from "../shared/i18n";
import { latestEventIdFromEvents } from "../shared/stream-close";
import { SseParser, type ParsedSseEvent } from "../shared/sse-parser";
import { NdjsonParser } from "../shared/ndjson-parser";
import { ConnectJsonParser } from "../shared/connect-json-parser";
import {
  clearConversationMergeSessions,
  conversationHasContent,
  discardConversationMergeSession,
  getConversationMergeSession,
  syncConversationMergeSession,
} from "../shared/ai-merge";
import { initEventsColumnResizers } from "./widgets/column-resizer";
import {
  elList,
  elMeta,
  elMetaMethod,
  elMetaUrl,
  elMetaTags,
  elStreamsUrlFilter,
  elStreamsTransportFilter,
  elExportJson,
  elExportCsv,
  elExportFixture,
  elImportJson,
  elPauseUi,
  elImportFile,
  elSaveArchive,
  elArchives,
  elStats,
  elAnomalies,
  elSpecWarnings,
  elSearchAll,
  elDialog,
  elDialogClose,
  elStatusbarCapture,
  elStatusbarLocale,
  elTabCountEvents,
  elTabCountRaw,
  elTabCountConversation,
  elExportMenu,
  elExportMenuBtn,
  elExportMenuPanel,
  elMoreMenu,
  elMoreMenuBtn,
  elMoreMenuPanel,
  elDrawer,
  elDrawerClose,
  elDrawerPrev,
  elDrawerNext,
  elDrawerCopy,
  elContextMenu,
  elEventsSearch,
  elDrawerSearch,
  elTableWrap,
  elSidebarResizer,
  elResizer,
  elEvents,
} from "./core/dom";
import { escapeHtml, formatDuration, closeReasonLabel } from "./core/format";
import { computeStreamMetrics } from "./features/stream-metrics";
import {
  clearStreamAnomalyCaches,
  invalidateStreamAnomalyCache,
} from "./features/stream-anomalies";
import { renderTimeline } from "./views/timeline-view";
import { renderRequest, resetRequestViewState } from "./views/request-view-ui";
import { renderConversation, resetConversationView } from "./views/conversation-view";
import { renderRawView, resetRawView } from "./views/raw-view";
import { state, type ActiveTab, type StreamParser } from "./core/state";
import {
  closeAllMenus,
  closeAppDialog,
  copyText,
  refreshStatusbarSummary,
  setUiPaused,
  showToast,
  toggleMenu,
} from "./core/ui-chrome";
import {
  addStaticStream,
  exportSelectedStreamCsv,
  exportSelectedStreamFixture,
  exportSelectedStreamJson,
  importStreamFromFile,
  saveSelectedStreamArchive,
  type ExportImportHooks,
} from "./features/export-import";
import {
  showAnomaliesDialog,
  showArchivesDialog,
  showGlobalSearchDialog,
  showSpecWarningsDialog,
  showStatsDialog,
  type DialogHooks,
} from "./features/dialogs";
import {
  applyDrawerWidth,
  applyDrawerSearch,
  applyEventsFilter,
  clearEventsView,
  closeDrawer,
  DRAWER_WIDTH_MAX,
  DRAWER_WIDTH_MIN,
  getBrowsableEvents,
  hideContextMenu,
  navigateDrawer,
  renderEvents,
  selectEventByIndex,
  updateDrawerNavButtons,
  bindJsonTreeContextMenu,
} from "./views/events-view";
import { renderList, scheduleRenderList } from "./views/stream-list";

const pauseHooks = {
  renderList,
  renderDetail,
};

const exportHooks: ExportImportHooks = {
  getBrowsableEvents,
  renderList,
  renderDetail,
};

const dialogHooks: DialogHooks = {
  renderList,
  renderDetail,
  activateTab: (tab) => activateTab(tab),
  selectEventByIndex,
  addStaticStream: (record) => addStaticStream(record, exportHooks),
};

function connect(): void {
  const port = chrome.runtime.connect({ name: PANEL_PORT });
  port.postMessage({
    type: "init",
    tabId: chrome.devtools.inspectedWindow.tabId,
  });

  port.onMessage.addListener((msg: RelayMessage) => {
    handleRelay(msg);
  });

  port.onDisconnect.addListener(() => {
    setTimeout(connect, 500);
  });
}

function handleRelay(msg: RelayMessage): void {
  switch (msg.type) {
    case "stream-start":
      onStart(msg.payload);
      break;
    case "stream-chunk":
      onChunk(msg.payload);
      break;
    case "stream-end":
      onEnd(msg.payload);
      break;
    case "stream-error":
      onError(msg.payload);
      break;
    case "stream-reconnect":
      onReconnect(msg.payload);
      break;
  }
}

function stampEvents(events: ParsedSseEvent[]): SseEvent[] {
  const now = Date.now();
  return events.map((e) => ({ ...e, receivedAt: now }));
}

function createParser(kind: StreamKind): StreamParser {
  if (kind === "ndjson") return new NdjsonParser();
  if (kind === "connect-json") return new ConnectJsonParser();
  return new SseParser();
}

function onStart(payload: StreamStartPayload): void {
  const existing = state.streams.get(payload.requestId);
  if (existing) {
    // Merge header metadata into a provisional row without wiping chunks already received.
    existing.url = payload.url;
    existing.method = payload.method;
    existing.status = payload.status ?? existing.status;
    existing.statusText = payload.statusText ?? existing.statusText;
    existing.contentType = payload.contentType ?? existing.contentType;
    existing.requestHeaders = payload.requestHeaders ?? existing.requestHeaders;
    existing.responseHeaders = payload.responseHeaders ?? existing.responseHeaders;
    existing.requestPayloadPreview =
      payload.requestPayloadPreview ?? existing.requestPayloadPreview;
    existing.requestPayloadTruncated =
      payload.requestPayloadTruncated ?? existing.requestPayloadTruncated;
    existing.transport = payload.transport;
    const prevKind = existing.streamKind;
    existing.streamKind = payload.streamKind;
    existing.startedAt = payload.startedAt;
    // Provisional announce may guess wrong (sse vs connect-json); swap parser when kind changes.
    if (!state.parsers.has(payload.requestId) || prevKind !== payload.streamKind) {
      const parser = createParser(payload.streamKind);
      state.parsers.set(payload.requestId, parser);
      // Chunks may have arrived under the wrong parser (postMessage race). Rebuild events from raw.
      if (prevKind !== payload.streamKind && existing.raw) {
        existing.events = [];
        const rebuilt = stampEvents([...parser.push(existing.raw), ...parser.flush()]);
        existing.events.push(...rebuilt);
        discardConversationMergeSession(payload.requestId);
        getConversationMergeSession(payload.requestId).push(existing.events, existing.url);
      }
    }
    if (state.uiPaused) {
      state.pendingListRefreshWhilePaused = true;
      if (state.selectedId === payload.requestId) state.pendingDetailRefreshWhilePaused = true;
    } else {
      renderList();
      if (state.selectedId === payload.requestId) {
        renderDetail(true);
      }
    }
    return;
  }

  const record: StreamRecord = {
    requestId: payload.requestId,
    url: payload.url,
    method: payload.method,
    status: payload.status,
    statusText: payload.statusText,
    contentType: payload.contentType,
    requestHeaders: payload.requestHeaders,
    responseHeaders: payload.responseHeaders,
    requestPayloadPreview: payload.requestPayloadPreview,
    requestPayloadTruncated: payload.requestPayloadTruncated,
    transport: payload.transport,
    streamKind: payload.streamKind,
    startedAt: payload.startedAt,
    streamStatus: "streaming",
    raw: "",
    events: [],
    origin: "live",
  };
  state.streams.set(payload.requestId, record);
  state.parsers.set(payload.requestId, createParser(payload.streamKind));

  if (!state.selectedId) {
    state.selectedId = payload.requestId;
  }

  if (state.uiPaused) {
    state.pendingListRefreshWhilePaused = true;
    if (state.selectedId === payload.requestId) state.pendingDetailRefreshWhilePaused = true;
  } else {
    renderList();
    if (state.selectedId === payload.requestId) {
      state.selectedEventIndex = null;
      renderDetail();
    }
  }
}

function onChunk(payload: StreamChunkPayload): void {
  const record = state.streams.get(payload.requestId);
  const parser = state.parsers.get(payload.requestId);
  if (!record || !parser) return;

  record.raw += payload.text;
  const events = stampEvents(parser.push(payload.text));
  if (events.length) {
    record.events.push(...events);
    const latestId = latestEventIdFromEvents(events);
    if (latestId) record.lastEventId = latestId;
  }
  // Keep merge session caught up so Conversation tab opens without a full re-parse.
  getConversationMergeSession(payload.requestId).push(record.events, record.url);

  if (state.uiPaused) {
    state.pendingListRefreshWhilePaused = true;
    if (state.selectedId === payload.requestId) state.pendingDetailRefreshWhilePaused = true;
    return;
  }
  // XHR can emit very frequent tiny deltas; avoid nuking the list DOM on every chunk.
  scheduleRenderList();
  if (state.selectedId === payload.requestId) {
    scheduleRenderDetail(true);
  }
}

function onEnd(payload: StreamEndPayload): void {
  const record = state.streams.get(payload.requestId);
  const parser = state.parsers.get(payload.requestId);
  if (!record) return;

  if (parser) {
    const rest = stampEvents(parser.flush());
    if (rest.length) {
      record.events.push(...rest);
      const latestId = latestEventIdFromEvents(rest);
      if (latestId) record.lastEventId = latestId;
    }
  }

  record.streamStatus = "done";
  record.endedAt = payload.endedAt;
  record.closeReason = payload.closeReason ?? "complete";
  record.metrics = computeStreamMetrics(record);
  if (state.uiPaused) {
    state.pendingListRefreshWhilePaused = true;
    if (state.selectedId === payload.requestId) state.pendingDetailRefreshWhilePaused = true;
    return;
  }
  renderList();
  if (state.selectedId === payload.requestId) {
    renderDetail(true);
  }
}

function onError(payload: StreamErrorPayload): void {
  const record = state.streams.get(payload.requestId);
  if (!record) return;
  record.streamStatus = "error";
  record.errorMessage = payload.message;
  record.closeReason = payload.closeReason ?? "error";
  record.endedAt = payload.endedAt;
  record.metrics = computeStreamMetrics(record);
  if (state.uiPaused) {
    state.pendingListRefreshWhilePaused = true;
    if (state.selectedId === payload.requestId) state.pendingDetailRefreshWhilePaused = true;
    return;
  }
  renderList();
  if (state.selectedId === payload.requestId) {
    renderDetail();
  }
}

function onReconnect(payload: StreamReconnectPayload): void {
  const record = state.streams.get(payload.requestId);
  if (!record) return;
  record.reconnectCount = payload.reconnectCount;
  if (payload.lastEventId) {
    record.lastEventId = payload.lastEventId;
  }
  const mark = {
    at: payload.at,
    reconnectCount: payload.reconnectCount,
    lastEventId: payload.lastEventId,
  };
  if (!record.reconnects) record.reconnects = [mark];
  else record.reconnects.push(mark);

  if (state.uiPaused) {
    state.pendingListRefreshWhilePaused = true;
    if (state.selectedId === payload.requestId) state.pendingDetailRefreshWhilePaused = true;
    return;
  }
  renderList();
  if (state.selectedId === payload.requestId) {
    renderDetail(true);
  }
}

function renderStreamMeta(record: StreamRecord | undefined): void {
  if (!record) {
    elMeta.classList.add("is-empty");
    elMetaMethod.textContent = "";
    elMetaUrl.textContent = t("selectStream");
    elMetaUrl.title = "";
    elMetaTags.innerHTML = "";
    return;
  }

  elMeta.classList.remove("is-empty");

  elMetaMethod.textContent = record.method;
  elMetaUrl.textContent = record.url;
  elMetaUrl.title = record.url;

  const bits: string[] = [];
  if (record.status != null) {
    const statusClass =
      record.streamStatus === "error" ? "error" : record.status >= 400 ? "error" : "ok";
    const statusText =
      record.statusText && record.statusText.trim()
        ? `${record.status} ${record.statusText}`
        : `HTTP ${record.status}`;
    bits.push(`<b class="meta-chip ${statusClass}">${escapeHtml(statusText)}</b>`);
  }
  if (record.contentType) {
    bits.push(`<span class="meta-chip">${escapeHtml(record.contentType)}</span>`);
  }
  const durationMs =
    typeof record.endedAt === "number"
      ? record.endedAt - record.startedAt
      : Date.now() - record.startedAt;
  if (Number.isFinite(durationMs) && durationMs >= 0) {
    bits.push(`<span class="meta-chip">${escapeHtml(formatDuration(durationMs))}</span>`);
  }
  if (record.closeReason && record.closeReason !== "complete") {
    bits.push(
      `<span class="meta-chip ${record.closeReason === "abort" ? "warn" : "error"}">${escapeHtml(
        closeReasonLabel(record.closeReason),
      )}</span>`,
    );
  }
  if (record.errorMessage) {
    bits.push(
      `<span class="meta-chip error">${escapeHtml(t("metaError", record.errorMessage))}</span>`,
    );
  }
  if (record.reconnectCount && record.reconnectCount > 0) {
    bits.push(
      `<span class="meta-chip warn">${escapeHtml(
        t("metaReconnects", String(record.reconnectCount)),
      )}</span>`,
    );
  }
  if (record.lastEventId) {
    bits.push(
      `<span class="meta-chip">${escapeHtml(t("metaLastEventId", record.lastEventId))}</span>`,
    );
  }
  elMetaTags.innerHTML = bits.join("");
}

function updateTabCounts(record: StreamRecord | undefined): void {
  if (elTabCountEvents) {
    if (record && record.events.length > 0) {
      elTabCountEvents.hidden = false;
      elTabCountEvents.textContent = String(record.events.length);
    } else {
      elTabCountEvents.hidden = true;
      elTabCountEvents.textContent = "";
    }
  }
  if (elTabCountRaw) {
    if (record && record.raw) {
      const kb = (record.raw.length / 1024).toFixed(record.raw.length >= 10240 ? 0 : 1);
      elTabCountRaw.hidden = false;
      elTabCountRaw.textContent = t("rawSizeKb", kb);
    } else {
      elTabCountRaw.hidden = true;
      elTabCountRaw.textContent = "";
    }
  }
  if (elTabCountConversation) {
    updateConversationTabCount(record);
  }
}

let convTabCountAt = 0;
let convTabCountEvents = -1;
let convTabCountRequestId: string | null = null;

function updateConversationTabCount(record: StreamRecord | undefined): void {
  if (!elTabCountConversation) return;
  if (!record || record.events.length === 0) {
    elTabCountConversation.hidden = true;
    elTabCountConversation.textContent = "";
    convTabCountRequestId = null;
    convTabCountEvents = -1;
    return;
  }

  const streaming = record.streamStatus === "streaming";
  const sameStream = convTabCountRequestId === record.requestId;
  const due =
    !streaming ||
    !sameStream ||
    Date.now() - convTabCountAt >= 400 ||
    record.events.length - convTabCountEvents >= 20 ||
    state.activeTab === "conversation";

  if (!due && sameStream) return;

  const merged = syncConversationMergeSession(record.requestId, record.events, record.url);
  convTabCountAt = Date.now();
  convTabCountEvents = record.events.length;
  convTabCountRequestId = record.requestId;

  if (conversationHasContent(merged)) {
    elTabCountConversation.hidden = false;
    const n =
      (merged.channels.content ? 1 : 0) +
      (merged.channels.reasoning ? 1 : 0) +
      (merged.channels.tools.length > 0 ? 1 : 0);
    elTabCountConversation.textContent = String(Math.max(n, 1));
  } else {
    elTabCountConversation.hidden = true;
    elTabCountConversation.textContent = "";
  }
}

/** Min gap between coalesced detail paints during high-frequency stream-chunk. */
const DETAIL_MIN_INTERVAL_MS = 100;

let detailRenderScheduled = false;
let detailRenderAppendFriendly = false;
let detailThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let detailRenderToken = 0;
let lastDetailRenderAt = 0;

function scheduleRenderDetail(appendFriendly = false): void {
  detailRenderAppendFriendly = detailRenderAppendFriendly || appendFriendly;
  if (detailRenderScheduled) return;
  detailRenderScheduled = true;
  const token = ++detailRenderToken;
  const delay = Math.max(0, DETAIL_MIN_INTERVAL_MS - (Date.now() - lastDetailRenderAt));

  const fire = (): void => {
    detailThrottleTimer = null;
    requestAnimationFrame(() => {
      if (token !== detailRenderToken) return;
      detailRenderScheduled = false;
      const append = detailRenderAppendFriendly;
      detailRenderAppendFriendly = false;
      lastDetailRenderAt = Date.now();
      paintDetail(append);
    });
  };

  if (delay === 0) {
    fire();
  } else {
    detailThrottleTimer = setTimeout(fire, delay);
  }
}

function renderDetail(appendFriendly = false): void {
  // Invalidate any pending coalesced paint so sync callers win immediately.
  detailRenderToken += 1;
  if (detailThrottleTimer != null) {
    clearTimeout(detailThrottleTimer);
    detailThrottleTimer = null;
  }
  detailRenderScheduled = false;
  const append = appendFriendly || detailRenderAppendFriendly;
  detailRenderAppendFriendly = false;
  lastDetailRenderAt = Date.now();
  paintDetail(append);
}

function paintDetail(appendFriendly = false): void {
  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
  if (!record) {
    renderStreamMeta(undefined);
    updateTabCounts(undefined);
    clearEventsView();
    resetRawView();
    renderTimelineForSelection(undefined);
    renderRequestForSelection(undefined);
    renderConversationForSelection(undefined);
    return;
  }

  renderStreamMeta(record);
  updateTabCounts(record);

  // Only paint the active detail tab; inactive panes refresh on tab click.
  if (state.activeTab === "events") {
    renderEvents(record, appendFriendly);
  } else if (state.activeTab === "timeline") {
    renderTimelineForSelection(record);
  } else if (state.activeTab === "request") {
    renderRequestForSelection(record);
  } else if (state.activeTab === "raw") {
    renderRawView(record);
  } else if (state.activeTab === "conversation") {
    renderConversationForSelection(record);
  }
}

function activateTab(tab: ActiveTab): void {
  state.activeTab = tab;
  document.querySelectorAll(".tab").forEach((node) => {
    const btn = node as HTMLButtonElement;
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${tab}`)?.classList.add("active");
}

function jumpToSelectedEventFromTimeline(eventIndex: number): void {
  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
  if (!record) return;
  activateTab("events");
  selectEventByIndex(record, eventIndex, { scrollMode: "start" });
}

function renderTimelineForSelection(record: StreamRecord | undefined): void {
  renderTimeline(record, {
    selectedEventIndex: state.selectedEventIndex,
    onJumpToEvent: jumpToSelectedEventFromTimeline,
  });
}

function renderRequestForSelection(record: StreamRecord | undefined): void {
  renderRequest(record, { onBindJsonTreeContextMenu: bindJsonTreeContextMenu });
}

function renderConversationForSelection(record: StreamRecord | undefined): void {
  renderConversation(record, { copyText, showToast });
}

function setupTabs(): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as ActiveTab;
      if (
        tab !== "events" &&
        tab !== "raw" &&
        tab !== "timeline" &&
        tab !== "request" &&
        tab !== "conversation"
      ) {
        return;
      }
      activateTab(tab);
      const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
      if (tab === "events") {
        if (record) renderEvents(record, false);
        else clearEventsView();
      } else if (tab === "timeline") {
        renderTimelineForSelection(record);
      } else if (tab === "request") {
        renderRequestForSelection(record);
      } else if (tab === "raw") {
        renderRawView(record);
      } else if (tab === "conversation") {
        renderConversationForSelection(record);
      }
    });
  });
}

function setupActions(): void {
  // Prefer pointerdown: XHR streaming may rewrite row contents between mousedown/mouseup.
  elList.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const li = (e.target as HTMLElement | null)?.closest("li.stream, li.stream-item");
    if (!(li instanceof HTMLLIElement) || !elList.contains(li)) return;
    const id = li.dataset.id;
    if (!id || !state.streams.has(id) || id === state.selectedId) return;
    state.selectedId = id;
    state.selectedEventIndex = null;
    renderList();
    renderDetail();
  });

  document.getElementById("btn-clear")?.addEventListener("click", () => {
    state.streams.clear();
    state.parsers.clear();
    clearStreamAnomalyCaches();
    clearConversationMergeSessions();
    resetRequestViewState();
    resetConversationView();
    resetRawView();
    state.selectedId = null;
    state.selectedEventIndex = null;
    state.streamsUrlFilterQuery = "";
    state.streamsTransportFilter = "all";
    state.pendingListRefreshWhilePaused = false;
    state.pendingDetailRefreshWhilePaused = false;
    elStreamsUrlFilter.value = "";
    elStreamsTransportFilter.value = "all";
    renderList();
    renderDetail();
  });

  elExportMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu(elExportMenuPanel, elExportMenuBtn);
  });

  elMoreMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu(elMoreMenuPanel, elMoreMenuBtn);
  });

  elExportMenuPanel?.addEventListener("click", () => {
    closeAllMenus();
  });

  elMoreMenuPanel?.addEventListener("click", () => {
    closeAllMenus();
  });

  elExportJson.addEventListener("click", () => {
    exportSelectedStreamJson();
  });

  elExportCsv.addEventListener("click", () => {
    exportSelectedStreamCsv(exportHooks);
  });

  elExportFixture.addEventListener("click", () => {
    exportSelectedStreamFixture();
  });

  elImportJson.addEventListener("click", () => {
    elImportFile.value = "";
    elImportFile.click();
  });

  elImportFile.addEventListener("change", () => {
    const file = elImportFile.files?.[0];
    if (!file) return;
    void importStreamFromFile(file, exportHooks).catch((err) => {
      window.alert(t("importFailed", err instanceof Error ? err.message : String(err)));
    });
  });

  elSaveArchive.addEventListener("click", () => {
    void saveSelectedStreamArchive().catch((err) => {
      window.alert(t("archiveSaveFailed", err instanceof Error ? err.message : String(err)));
    });
  });

  elArchives.addEventListener("click", () => {
    void showArchivesDialog(dialogHooks).catch((err) => {
      window.alert(t("archivesOpenFailed", err instanceof Error ? err.message : String(err)));
    });
  });

  elStats.addEventListener("click", () => {
    showStatsDialog();
  });

  elAnomalies.addEventListener("click", () => {
    showAnomaliesDialog(dialogHooks);
  });

  elSpecWarnings.addEventListener("click", () => {
    showSpecWarningsDialog(dialogHooks);
  });

  elSearchAll.addEventListener("click", () => {
    showGlobalSearchDialog(dialogHooks);
  });

  elPauseUi.addEventListener("click", () => {
    setUiPaused(!state.uiPaused, pauseHooks);
  });

  elDialogClose.addEventListener("click", () => {
    closeAppDialog();
  });

  elDialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeAppDialog();
  });

  document.getElementById("btn-copy-raw")?.addEventListener("click", async () => {
    const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
    if (!record) return;
    await copyText(record.raw, true);
  });

  document.getElementById("btn-settings")?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });

  elDrawerClose.addEventListener("click", () => {
    closeDrawer();
  });

  elDrawerPrev.addEventListener("click", () => {
    navigateDrawer(-1);
  });

  elDrawerNext.addEventListener("click", () => {
    navigateDrawer(1);
  });

  elDrawerCopy.addEventListener("click", async () => {
    if (state.drawerEventData == null) return;
    await copyText(state.drawerEventData, true);
  });

  elEventsSearch.addEventListener("input", () => {
    state.eventsSearchQuery = elEventsSearch.value;
    applyEventsFilter();
    updateDrawerNavButtons();
  });

  elStreamsUrlFilter.addEventListener("input", () => {
    state.streamsUrlFilterQuery = elStreamsUrlFilter.value;
    renderList();
  });

  elStreamsTransportFilter.addEventListener("change", () => {
    const value = elStreamsTransportFilter.value;
    state.streamsTransportFilter =
      value === "fetch" || value === "eventsource" || value === "xhr" ? value : "all";
    renderList();
  });

  elDrawerSearch.addEventListener("input", () => {
    state.drawerSearchQuery = elDrawerSearch.value;
    applyDrawerSearch();
  });

  elContextMenu.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest("button[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "copy-data" && state.contextMenuData?.kind === "event-data") {
      await copyText(state.contextMenuData.data, true);
    } else if (action === "copy-json-value" && state.contextMenuData?.kind === "json-node") {
      if (state.contextMenuData.value != null) {
        await copyText(state.contextMenuData.value, true);
      }
    } else if (action === "copy-json-path" && state.contextMenuData?.kind === "json-node") {
      await copyText(state.contextMenuData.path, true);
    }
    hideContextMenu();
  });

  document.addEventListener("click", (e) => {
    hideContextMenu();
    const target = e.target as Node | null;
    if (
      (elExportMenu && target && elExportMenu.contains(target)) ||
      (elMoreMenu && target && elMoreMenu.contains(target))
    ) {
      return;
    }
    closeAllMenus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideContextMenu();
      closeAllMenus();
      return;
    }
    if (elDrawer.hidden) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
    ) {
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      navigateDrawer(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      navigateDrawer(1);
    }
  });
  window.addEventListener("blur", () => {
    hideContextMenu();
    closeAllMenus();
  });
  elTableWrap.addEventListener("scroll", () => hideContextMenu());
}

function setupSidebarResizer(): void {
  const SIDEBAR_MIN = 180;
  const SIDEBAR_MAX = 640;

  const readSidebarWidth = (): number => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--sidebar").trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 286;
  };

  elSidebarResizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.pageX;
    const startWidth = readSidebarWidth();

    elSidebarResizer.classList.add("resizing");

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + (ev.pageX - startX)));
      document.documentElement.style.setProperty("--sidebar", `${next}px`);
    };

    const onUp = () => {
      elSidebarResizer.classList.remove("resizing");
      document.body.classList.remove("is-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    document.body.classList.add("is-resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

function setupResizer(): void {
  applyDrawerWidth();

  elResizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const rect = elEvents.getBoundingClientRect();
      if (rect.width <= 0) return;
      const fromRight = ((rect.right - ev.clientX) / rect.width) * 100;
      state.drawerWidthPercent = Math.min(DRAWER_WIDTH_MAX, Math.max(DRAWER_WIDTH_MIN, fromRight));
      applyDrawerWidth();
    };
    const onUp = () => {
      document.body.classList.remove("is-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

setupTabs();
setupActions();
setupSidebarResizer();
setupResizer();
initEventsColumnResizers(document.getElementById("events-table") as HTMLTableElement);
applyIcons();

function refreshLocaleUi(): void {
  document.documentElement.lang = uiLanguage();
  document.title = t("panelTitle");
  applyDomI18n();
  setUiPaused(state.uiPaused, pauseHooks);
  if (elStatusbarLocale) {
    const version = chrome.runtime.getManifest?.().version ?? "1.0.0";
    elStatusbarLocale.textContent =
      getActiveLocale() === "zh_CN" ? `中文 · ${version}` : `EN · ${version}`;
  }
  if (elStatusbarCapture && !state.uiPaused) {
    elStatusbarCapture.textContent = t("statusbarCaptureActive");
  }
  refreshStatusbarSummary();
  renderList();
  renderDetail();
}

void initI18n().then(() => {
  refreshLocaleUi();
  connect();
  onLocaleChange(() => {
    refreshLocaleUi();
  });
});
