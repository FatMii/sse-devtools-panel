import "./panel.css";
import type {
  RelayMessage,
  SseEvent,
  StreamMetrics,
  StreamRecord,
  StreamKind,
  StreamStartPayload,
  StreamTransport,
  StreamChunkPayload,
  StreamEndPayload,
  StreamErrorPayload,
} from "../shared/types";
import { applyDomI18n, initI18n, onLocaleChange, t, uiLanguage } from "../shared/i18n";
import { SseParser, type ParsedSseEvent } from "../shared/sse-parser";
import { NdjsonParser } from "../shared/ndjson-parser";
import { compileTextFilter } from "../shared/text-filter";
import {
  deleteStreamArchive,
  getStreamArchive,
  listStreamArchives,
  saveStreamArchive,
  type StreamArchiveEntry,
} from "../shared/stream-archive-db";
import {
  buildSseFixture,
  buildStreamExportCsv,
  buildStreamExportPayload,
  createRequestId,
  parseStreamExportJson,
  streamRecordFromExport,
} from "../shared/stream-snapshot";
import {
  scanStreamSpecWarnings,
  type SseSpecWarning,
  type SseSpecWarningKind,
} from "../shared/sse-spec";
import {
  buildGapHistogram,
  buildTimelineMarks,
  collectEventGaps,
  largestGaps,
  timelineSpanMs,
  type HistogramBin,
} from "../shared/stream-timing";
import { applyTreeSearch, createJsonTree, tryParseJsonValue } from "./json-tree";
import { initEventsColumnResizers } from "./column-resizer";

const PANEL_PORT = "sse-devtools-panel";
const DATA_PREVIEW_LEN = 80;
const DRAWER_WIDTH_MIN = 20;
const DRAWER_WIDTH_MAX = 75;
const DRAWER_WIDTH_DEFAULT = 42;

type StreamParser = {
  push(chunk: string): ParsedSseEvent[];
  flush(): ParsedSseEvent[];
};

type StreamAnomalyKind = "empty-data" | "json-parse-failed" | "duplicate-id" | "oversized-packet";

type StreamAnomaly = {
  kind: StreamAnomalyKind;
  eventIndex: number;
  message: string;
};

const streams = new Map<string, StreamRecord>();
const parsers = new Map<string, StreamParser>();
let selectedId: string | null = null;
let selectedEventIndex: number | null = null;
/** Data of the event currently shown in the drawer (for Copy). */
let drawerEventData: string | null = null;
/** Index of the event currently shown in the drawer. */
let drawerEventIndex: number | null = null;
/** Data targeted by the row context menu. */
let contextMenuData: string | null = null;
let activeTab: "events" | "raw" | "timeline" = "events";
let drawerWidthPercent = DRAWER_WIDTH_DEFAULT;
let eventsSearchQuery = "";
let drawerSearchQuery = "";
let streamsUrlFilterQuery = "";
let streamsTransportFilter: StreamTransport | "all" = "all";
let uiPaused = false;
let pendingListRefreshWhilePaused = false;
let pendingDetailRefreshWhilePaused = false;
const anomalyCache = new Map<string, { eventCount: number; anomalies: StreamAnomaly[] }>();
const specWarningCache = new Map<string, { eventCount: number; rawLen: number; warnings: SseSpecWarning[] }>();

const elList = document.getElementById("stream-list") as HTMLUListElement;
const elEmpty = document.getElementById("empty-hint") as HTMLDivElement;
const elMeta = document.getElementById("meta") as HTMLDivElement;
const elMetaMethod = document.getElementById("meta-method") as HTMLSpanElement;
const elMetaUrl = document.getElementById("meta-url") as HTMLSpanElement;
const elMetaTags = document.getElementById("meta-tags") as HTMLDivElement;
const elMetaDetails = document.getElementById("meta-details") as HTMLDetailsElement;
const elMetaDetailsBody = document.getElementById("meta-details-body") as HTMLDivElement;
const elEvents = document.getElementById("view-events") as HTMLDivElement;
const elPlaceholder = document.getElementById("events-placeholder") as HTMLDivElement;
const elTableWrap = document.getElementById("events-table-wrap") as HTMLDivElement;
const elTbody = document.getElementById("events-tbody") as HTMLTableSectionElement;
const elEventsSearch = document.getElementById("events-search") as HTMLInputElement;
const elResizer = document.getElementById("events-resizer") as HTMLDivElement;
const elDrawer = document.getElementById("events-drawer") as HTMLElement;
const elDrawerTitle = document.getElementById("drawer-title") as HTMLSpanElement;
const elDrawerBody = document.getElementById("drawer-body") as HTMLDivElement;
const elDrawerSearch = document.getElementById("drawer-search") as HTMLInputElement;
const elDrawerClose = document.getElementById("drawer-close") as HTMLButtonElement;
const elDrawerPrev = document.getElementById("drawer-prev") as HTMLButtonElement;
const elDrawerNext = document.getElementById("drawer-next") as HTMLButtonElement;
const elDrawerCopy = document.getElementById("drawer-copy") as HTMLButtonElement;
const elContextMenu = document.getElementById("row-context-menu") as HTMLDivElement;
const elRaw = document.getElementById("view-raw") as HTMLPreElement;
const elTimelinePlaceholder = document.getElementById("timeline-placeholder") as HTMLDivElement;
const elTimelineBody = document.getElementById("timeline-body") as HTMLDivElement;
const elStreamsUrlFilter = document.getElementById("streams-url-filter") as HTMLInputElement;
const elStreamsTransportFilter = document.getElementById("streams-transport-filter") as HTMLSelectElement;
const elExportJson = document.getElementById("btn-export-json") as HTMLButtonElement;
const elExportCsv = document.getElementById("btn-export-csv") as HTMLButtonElement;
const elExportFixture = document.getElementById("btn-export-fixture") as HTMLButtonElement;
const elImportJson = document.getElementById("btn-import-json") as HTMLButtonElement;
const elPauseUi = document.getElementById("btn-pause-ui") as HTMLButtonElement;
const elImportFile = document.getElementById("import-file") as HTMLInputElement;
const elSaveArchive = document.getElementById("btn-save-archive") as HTMLButtonElement;
const elArchives = document.getElementById("btn-archives") as HTMLButtonElement;
const elStats = document.getElementById("btn-stats") as HTMLButtonElement;
const elAnomalies = document.getElementById("btn-anomalies") as HTMLButtonElement;
const elSpecWarnings = document.getElementById("btn-spec-warnings") as HTMLButtonElement;
const elSearchAll = document.getElementById("btn-search-all") as HTMLButtonElement;
const elDialog = document.getElementById("app-dialog") as HTMLDialogElement;
const elDialogTitle = document.getElementById("app-dialog-title") as HTMLSpanElement;
const elDialogBody = document.getElementById("app-dialog-body") as HTMLDivElement;
const elDialogClose = document.getElementById("app-dialog-close") as HTMLButtonElement;

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
    case "stream-discard":
      onDiscard(msg.payload.requestId);
      break;
  }
}

function stampEvents(events: ParsedSseEvent[]): SseEvent[] {
  const now = Date.now();
  return events.map((e) => ({ ...e, receivedAt: now }));
}

function createParser(kind: StreamKind): StreamParser {
  return kind === "ndjson" ? new NdjsonParser() : new SseParser();
}

function onStart(payload: StreamStartPayload): void {
  const existing = streams.get(payload.requestId);
  if (existing) {
    // Merge header metadata into a provisional row without wiping chunks already received.
    existing.url = payload.url;
    existing.method = payload.method;
    existing.status = payload.status ?? existing.status;
    existing.contentType = payload.contentType ?? existing.contentType;
    existing.requestHeaders = payload.requestHeaders ?? existing.requestHeaders;
    existing.requestPayloadPreview = payload.requestPayloadPreview ?? existing.requestPayloadPreview;
    existing.requestPayloadTruncated =
      payload.requestPayloadTruncated ?? existing.requestPayloadTruncated;
    existing.transport = payload.transport;
    existing.streamKind = payload.streamKind;
    existing.startedAt = payload.startedAt;
    if (!parsers.has(payload.requestId)) {
      parsers.set(payload.requestId, createParser(payload.streamKind));
    }
    if (uiPaused) {
      pendingListRefreshWhilePaused = true;
      if (selectedId === payload.requestId) pendingDetailRefreshWhilePaused = true;
    } else {
      renderList();
      if (selectedId === payload.requestId) {
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
    contentType: payload.contentType,
    requestHeaders: payload.requestHeaders,
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
  streams.set(payload.requestId, record);
  parsers.set(payload.requestId, createParser(payload.streamKind));

  if (!selectedId) {
    selectedId = payload.requestId;
  }

  if (uiPaused) {
    pendingListRefreshWhilePaused = true;
    if (selectedId === payload.requestId) pendingDetailRefreshWhilePaused = true;
  } else {
    renderList();
    if (selectedId === payload.requestId) {
      selectedEventIndex = null;
      renderDetail();
    }
  }
}

function onDiscard(requestId: string): void {
  streams.delete(requestId);
  parsers.delete(requestId);
  anomalyCache.delete(requestId);
  specWarningCache.delete(requestId);
  if (selectedId === requestId) {
    selectedId = null;
    selectedEventIndex = null;
    const next = Array.from(streams.keys())[0] ?? null;
    selectedId = next;
  }
  if (uiPaused) {
    pendingListRefreshWhilePaused = true;
    pendingDetailRefreshWhilePaused = true;
    return;
  }
  renderList();
  renderDetail();
}

function onChunk(payload: StreamChunkPayload): void {
  const record = streams.get(payload.requestId);
  const parser = parsers.get(payload.requestId);
  if (!record || !parser) return;

  record.raw += payload.text;
  const events = stampEvents(parser.push(payload.text));
  if (events.length) {
    record.events.push(...events);
  }

  if (uiPaused) {
    pendingListRefreshWhilePaused = true;
    if (selectedId === payload.requestId) pendingDetailRefreshWhilePaused = true;
    return;
  }
  // XHR can emit very frequent tiny deltas; avoid nuking the list DOM on every chunk.
  scheduleRenderList();
  if (selectedId === payload.requestId) {
    scheduleRenderDetail(true);
  }
}

function computeStreamMetrics(record: StreamRecord): StreamMetrics {
  const events = record.events;
  const firstTs = events[0]?.receivedAt;
  const endedAt = record.endedAt;
  const durationMs =
    typeof endedAt === "number" && endedAt >= record.startedAt ? endedAt - record.startedAt : undefined;
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
    durationMs && durationMs > 0 ? Number((events.length / (durationMs / 1000)).toFixed(2)) : undefined;
  return { ttftMs, durationMs, avgGapMs, p95GapMs, eventsPerSec };
}

function ensureStreamMetrics(record: StreamRecord): StreamMetrics {
  if (record.metrics) return record.metrics;
  const next = computeStreamMetrics(record);
  record.metrics = next;
  return next;
}

function onEnd(payload: StreamEndPayload): void {
  const record = streams.get(payload.requestId);
  const parser = parsers.get(payload.requestId);
  if (!record) return;

  if (parser) {
    const rest = stampEvents(parser.flush());
    if (rest.length) {
      record.events.push(...rest);
    }
  }

  record.streamStatus = "done";
  record.endedAt = payload.endedAt;
  record.metrics = computeStreamMetrics(record);
  if (uiPaused) {
    pendingListRefreshWhilePaused = true;
    if (selectedId === payload.requestId) pendingDetailRefreshWhilePaused = true;
    return;
  }
  renderList();
  if (selectedId === payload.requestId) {
    renderDetail(true);
  }
}

function onError(payload: StreamErrorPayload): void {
  const record = streams.get(payload.requestId);
  if (!record) return;
  record.streamStatus = "error";
  record.errorMessage = payload.message;
  record.endedAt = payload.endedAt;
  record.metrics = computeStreamMetrics(record);
  if (uiPaused) {
    pendingListRefreshWhilePaused = true;
    if (selectedId === payload.requestId) pendingDetailRefreshWhilePaused = true;
    return;
  }
  renderList();
  if (selectedId === payload.requestId) {
    renderDetail();
  }
}

function shortPath(url: string): string {
  try {
    const u = new URL(url, "https://example.com");
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function previewData(data: string): string {
  const oneLine = data.replace(/\s+/g, " ").trim();
  if (oneLine.length <= DATA_PREVIEW_LEN) return oneLine;
  return oneLine.slice(0, DATA_PREVIEW_LEN) + "…";
}

function payloadPreviewForMeta(record: StreamRecord): string {
  const text = record.requestPayloadPreview;
  if (!text) return t("metaPayloadNone");
  const oneLine = text.replace(/\s+/g, " ").trim();
  const clipped = oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
  return record.requestPayloadTruncated ? `${clipped}…` : clipped;
}

function renderStreamMeta(record: StreamRecord | undefined): void {
  if (!record) {
    elMeta.classList.add("is-empty");
    elMetaMethod.textContent = "";
    elMetaUrl.textContent = t("selectStream");
    elMetaUrl.title = "";
    elMetaTags.innerHTML = "";
    elMetaDetails.hidden = true;
    elMetaDetailsBody.innerHTML = "";
    return;
  }

  elMeta.classList.remove("is-empty");
  const headerCount = record.requestHeaders ? Object.keys(record.requestHeaders).length : 0;
  const payloadPreview = payloadPreviewForMeta(record);

  elMetaMethod.textContent = record.method;
  elMetaUrl.textContent = shortPath(record.url);
  elMetaUrl.title = record.url;

  const tags: string[] = [];
  if (record.status != null) {
    tags.push(`<span class="meta-chip">${escapeHtml(`HTTP ${record.status}`)}</span>`);
  }
  if (record.contentType) {
    tags.push(`<span class="meta-chip">${escapeHtml(record.contentType)}</span>`);
  }
  tags.push(`<span class="meta-chip">${escapeHtml(transportLabel(record.transport))}</span>`);
  if (record.errorMessage) {
    tags.push(
      `<span class="meta-chip error">${escapeHtml(t("metaError", record.errorMessage))}</span>`,
    );
  }
  elMetaTags.innerHTML = tags.join("");

  elMetaDetails.hidden = false;
  elMetaDetailsBody.innerHTML = `
    <div class="meta-detail-row">
      <span class="meta-detail-label">${escapeHtml(t("metaHeadersCount", String(headerCount)))}</span>
    </div>
    <div class="meta-detail-row">
      <span class="meta-detail-label">${escapeHtml(t("metaPayloadLabel"))}</span>
      <pre class="meta-payload-preview">${escapeHtml(payloadPreview)}</pre>
    </div>
  `;
}

const OVERSIZED_PACKET_THRESHOLD = 16_000;

function anomalyKindLabel(kind: StreamAnomalyKind): string {
  switch (kind) {
    case "empty-data":
      return t("anomalyEmptyData");
    case "json-parse-failed":
      return t("anomalyJsonParseFailed");
    case "duplicate-id":
      return t("anomalyDuplicateId");
    case "oversized-packet":
      return t("anomalyOversizedPacket");
    default:
      return kind;
  }
}

function scanStreamAnomalies(record: StreamRecord): StreamAnomaly[] {
  const cached = anomalyCache.get(record.requestId);
  if (cached && cached.eventCount === record.events.length) {
    return cached.anomalies;
  }
  const seenIds = new Set<string>();
  const anomalies: StreamAnomaly[] = [];
  for (const ev of record.events) {
    const data = ev.data ?? "";
    if (!data.trim()) {
      anomalies.push({
        kind: "empty-data",
        eventIndex: ev.index,
        message: t("anomalyEmptyDataDesc"),
      });
    }
    const trimmed = data.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(data);
      } catch {
        anomalies.push({
          kind: "json-parse-failed",
          eventIndex: ev.index,
          message: t("anomalyJsonParseFailedDesc"),
        });
      }
    }
    if (ev.id) {
      if (seenIds.has(ev.id)) {
        anomalies.push({
          kind: "duplicate-id",
          eventIndex: ev.index,
          message: t("anomalyDuplicateIdDesc", ev.id),
        });
      } else {
        seenIds.add(ev.id);
      }
    }
    if (data.length >= OVERSIZED_PACKET_THRESHOLD) {
      anomalies.push({
        kind: "oversized-packet",
        eventIndex: ev.index,
        message: t("anomalyOversizedPacketDesc", String(data.length)),
      });
    }
  }
  anomalyCache.set(record.requestId, { eventCount: record.events.length, anomalies });
  return anomalies;
}

function getStreamSpecWarnings(record: StreamRecord): SseSpecWarning[] {
  const cached = specWarningCache.get(record.requestId);
  if (
    cached &&
    cached.eventCount === record.events.length &&
    cached.rawLen === record.raw.length
  ) {
    return cached.warnings;
  }
  const warnings = scanStreamSpecWarnings(record);
  specWarningCache.set(record.requestId, {
    eventCount: record.events.length,
    rawLen: record.raw.length,
    warnings,
  });
  return warnings;
}

function specWarningKindLabel(kind: SseSpecWarningKind): string {
  switch (kind) {
    case "unknown-field":
      return t("specUnknownField");
    case "invalid-retry":
      return t("specInvalidRetry");
    case "null-in-id":
      return t("specNullInId");
    case "bom":
      return t("specBom");
    default:
      return kind;
  }
}

function specWarningMessage(warning: SseSpecWarning): string {
  switch (warning.kind) {
    case "unknown-field":
      return t("specUnknownFieldDesc", warning.detail ?? "");
    case "invalid-retry":
      return t("specInvalidRetryDesc", warning.detail ?? "");
    case "null-in-id":
      return t("specNullInIdDesc");
    case "bom":
      return t("specBomDesc");
    default:
      return warning.kind;
  }
}

function eventMatchesSearch(ev: SseEvent, query: string): boolean {
  // Align with Chrome Network EventStream: filter on event type + data payload
  const filter = compileTextFilter(query);
  if (filter.isEmpty) return true;
  return filter.test(ev.event) || filter.test(ev.data);
}

/** Events currently visible under the Events search filter (ordered). */
function getBrowsableEvents(record: StreamRecord): SseEvent[] {
  return record.events.filter((ev) => eventMatchesSearch(ev, eventsSearchQuery));
}

function selectEventByIndex(record: StreamRecord, index: number): void {
  const ev = record.events.find((e) => e.index === index);
  if (!ev) return;
  selectedEventIndex = index;
  syncRowSelection();
  openDrawer(ev);
  const row = elTbody.querySelector<HTMLTableRowElement>(`tr[data-index="${index}"]`);
  row?.scrollIntoView({ block: "nearest" });
}

function navigateDrawer(offset: -1 | 1): void {
  const record = selectedId ? streams.get(selectedId) : undefined;
  if (!record || selectedEventIndex == null) return;

  const browsable = getBrowsableEvents(record);
  if (browsable.length === 0) return;

  const pos = browsable.findIndex((ev) => ev.index === selectedEventIndex);
  if (pos === -1) return;

  const nextPos = pos + offset;
  if (nextPos < 0 || nextPos >= browsable.length) return;
  selectEventByIndex(record, browsable[nextPos].index);
}

function updateDrawerNavButtons(): void {
  const record = selectedId ? streams.get(selectedId) : undefined;
  if (!record || selectedEventIndex == null || elDrawer.hidden) {
    elDrawerPrev.disabled = true;
    elDrawerNext.disabled = true;
    return;
  }

  const browsable = getBrowsableEvents(record);
  const pos = browsable.findIndex((ev) => ev.index === selectedEventIndex);
  elDrawerPrev.disabled = pos <= 0;
  elDrawerNext.disabled = pos === -1 || pos >= browsable.length - 1;
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "stream";
}

function buildExportFilename(record: StreamRecord, ext: "json" | "csv" | "sse"): string {
  const path = shortPath(record.url).replace(/^\//, "") || "stream";
  const stamp = new Date(record.startedAt).toISOString().replace(/[:.]/g, "-");
  return `sse-stream-${sanitizeFilenamePart(path)}-${stamp}.${ext}`;
}

function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Portable snapshot of the selected stream for sharing / issue repro. */
function exportSelectedStreamJson(): void {
  const record = selectedId ? streams.get(selectedId) : undefined;
  if (!record) {
    window.alert(t("needSelectedStream"));
    return;
  }
  const payload = buildStreamExportPayload(record);
  downloadTextFile(
    buildExportFilename(record, "json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "application/json;charset=utf-8",
  );
}

/** Spreadsheet-friendly export; respects current Events search filter. */
function exportSelectedStreamCsv(): void {
  const record = selectedId ? streams.get(selectedId) : undefined;
  if (!record) {
    window.alert(t("needSelectedStream"));
    return;
  }
  const visible = getBrowsableEvents(record);
  if (visible.length === 0) {
    window.alert(t("exportCsvEmpty"));
    return;
  }
  downloadTextFile(
    buildExportFilename(record, "csv"),
    buildStreamExportCsv(record, visible),
    "text/csv;charset=utf-8",
  );
}

/** Local mock/replay file: rebuild standard text/event-stream from parsed events. */
function exportSelectedStreamFixture(): void {
  const record = selectedId ? streams.get(selectedId) : undefined;
  if (!record) {
    window.alert(t("needSelectedStream"));
    return;
  }
  if (record.events.length === 0) {
    window.alert(t("exportFixtureEmpty"));
    return;
  }
  downloadTextFile(
    buildExportFilename(record, "sse"),
    buildSseFixture(record.events),
    "text/event-stream;charset=utf-8",
  );
}

function addStaticStream(record: StreamRecord): void {
  streams.set(record.requestId, record);
  parsers.delete(record.requestId);
  selectedId = record.requestId;
  selectedEventIndex = null;
  renderList();
  renderDetail();
}

async function importStreamFromFile(file: File): Promise<void> {
  const text = await file.text();
  const body = parseStreamExportJson(text);
  const record = streamRecordFromExport(body, {
    requestId: createRequestId("imp"),
    origin: "imported",
  });
  addStaticStream(record);
}

async function saveSelectedStreamArchive(): Promise<void> {
  const record = selectedId ? streams.get(selectedId) : undefined;
  if (!record) {
    window.alert(t("needSelectedStream"));
    return;
  }
  const defaultName = `${shortPath(record.url)} @ ${new Date(record.startedAt).toLocaleString()}`;
  const name = window.prompt(t("archiveNamePrompt"), defaultName);
  if (name == null) return;
  if (!name.trim()) {
    window.alert(t("archiveNameRequired"));
    return;
  }
  await saveStreamArchive(name, record);
  window.alert(t("archiveSaved"));
}

function closeAppDialog(): void {
  if (elDialog.open) elDialog.close();
  elDialogBody.innerHTML = "";
  elDialogTitle.textContent = "";
}

function openAppDialog(title: string, body: HTMLElement): void {
  elDialogTitle.textContent = title;
  elDialogBody.innerHTML = "";
  elDialogBody.appendChild(body);
  if (!elDialog.open) elDialog.showModal();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

function formatMetricMs(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return `${Math.round(ms)} ms`;
}

function formatGapBinLabel(bin: HistogramBin): string {
  if (!Number.isFinite(bin.toMs)) {
    return bin.fromMs >= 1000 ? `≥${bin.fromMs / 1000}s` : `≥${bin.fromMs}ms`;
  }
  return `${bin.fromMs}–${bin.toMs}ms`;
}

function createGapHistogramSvg(bins: HistogramBin[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "gap-histogram");
  svg.setAttribute("viewBox", "0 0 440 170");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("timelineGapHistogram"));

  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const padL = 42;
  const padR = 12;
  const padT = 22;
  const padB = 48;
  const plotW = 440 - padL - padR;
  const plotH = 170 - padT - padB;
  const gap = 4;
  const barW = Math.max(8, (plotW - gap * (bins.length - 1)) / bins.length);
  const hotThreshold = 500;

  // Y-axis baseline + value ticks
  const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  axis.setAttribute("class", "plot-axis");
  axis.setAttribute("x1", String(padL));
  axis.setAttribute("y1", String(padT));
  axis.setAttribute("x2", String(padL));
  axis.setAttribute("y2", String(padT + plotH));
  svg.appendChild(axis);

  const base = document.createElementNS("http://www.w3.org/2000/svg", "line");
  base.setAttribute("class", "plot-axis");
  base.setAttribute("x1", String(padL));
  base.setAttribute("y1", String(padT + plotH));
  base.setAttribute("x2", String(padL + plotW));
  base.setAttribute("y2", String(padT + plotH));
  svg.appendChild(base);

  for (const ratio of [0, 0.5, 1]) {
    const value = Math.round(maxCount * ratio);
    const y = padT + plotH - ratio * plotH;
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "text");
    tick.setAttribute("class", "axis-label");
    tick.setAttribute("x", String(padL - 6));
    tick.setAttribute("y", String(y + 3));
    tick.setAttribute("text-anchor", "end");
    tick.textContent = String(value);
    svg.appendChild(tick);
  }

  const yTitle = document.createElementNS("http://www.w3.org/2000/svg", "text");
  yTitle.setAttribute("class", "axis-title");
  yTitle.setAttribute("x", "10");
  yTitle.setAttribute("y", String(padT + plotH / 2));
  yTitle.setAttribute("text-anchor", "middle");
  yTitle.setAttribute("transform", `rotate(-90 10 ${padT + plotH / 2})`);
  yTitle.textContent = t("timelineGapHistogramY");
  svg.appendChild(yTitle);

  for (let i = 0; i < bins.length; i += 1) {
    const bin = bins[i];
    const h = (bin.count / maxCount) * plotH;
    const x = padL + i * (barW + gap);
    const y = padT + plotH - h;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", `bar${bin.fromMs >= hotThreshold ? " is-hot" : ""}`);
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(barW));
    rect.setAttribute("height", String(Math.max(bin.count > 0 ? 2 : 0, h)));
    rect.setAttribute("rx", "2");
    rect.setAttribute(
      "title",
      t("timelineGapBinTitle", [formatGapBinLabel(bin), String(bin.count)]),
    );
    svg.appendChild(rect);

    if (bin.count > 0) {
      const countText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      countText.setAttribute("class", "count-label");
      countText.setAttribute("x", String(x + barW / 2));
      countText.setAttribute("y", String(Math.max(14, y - 4)));
      countText.setAttribute("text-anchor", "middle");
      countText.textContent = String(bin.count);
      svg.appendChild(countText);
    }

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "axis-label bin-label");
    label.setAttribute("x", String(x + barW / 2));
    label.setAttribute("y", String(padT + plotH + 14));
    label.setAttribute("text-anchor", "middle");
    label.textContent = formatGapBinLabel(bin);
    svg.appendChild(label);
  }

  const xTitle = document.createElementNS("http://www.w3.org/2000/svg", "text");
  xTitle.setAttribute("class", "axis-title");
  xTitle.setAttribute("x", String(padL + plotW / 2));
  xTitle.setAttribute("y", "164");
  xTitle.setAttribute("text-anchor", "middle");
  xTitle.textContent = t("timelineGapHistogramX");
  svg.appendChild(xTitle);

  return svg;
}

function setUiPaused(next: boolean): void {
  uiPaused = next;
  elPauseUi.classList.toggle("is-paused", uiPaused);
  elPauseUi.textContent = uiPaused ? t("resumeUi") : t("pauseUi");
  elPauseUi.title = uiPaused ? t("resumeUiTitle") : t("pauseUiTitle");
  if (!uiPaused) {
    if (pendingListRefreshWhilePaused) renderList();
    if (pendingDetailRefreshWhilePaused) renderDetail(true);
    pendingListRefreshWhilePaused = false;
    pendingDetailRefreshWhilePaused = false;
  }
}

function showStatsDialog(): void {
  const items = Array.from(streams.values());
  const eventCount = items.reduce((sum, s) => sum + s.events.length, 0);
  const streaming = items.filter((s) => s.streamStatus === "streaming").length;
  const done = items.filter((s) => s.streamStatus === "done").length;
  const error = items.filter((s) => s.streamStatus === "error").length;
  const durations = items
    .filter((s) => typeof s.endedAt === "number")
    .map((s) => (s.endedAt as number) - s.startedAt)
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const avgMs =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const selected = selectedId ? streams.get(selectedId) : undefined;

  const body = document.createElement("div");
  body.className = "stats-grid";
  body.innerHTML = `
    <div class="stats-row"><span>${escapeHtml(t("statsStreamCount"))}</span><strong>${items.length}</strong></div>
    <div class="stats-row"><span>${escapeHtml(t("statsEventCount"))}</span><strong>${eventCount}</strong></div>
    <div class="stats-row"><span>${escapeHtml(t("statsStreamingCount"))}</span><strong>${streaming}</strong></div>
    <div class="stats-row"><span>${escapeHtml(t("statsDoneCount"))}</span><strong>${done}</strong></div>
    <div class="stats-row"><span>${escapeHtml(t("statsErrorCount"))}</span><strong>${error}</strong></div>
    <div class="stats-row"><span>${escapeHtml(t("statsAvgDuration"))}</span><strong>${
      avgMs == null ? "—" : escapeHtml(formatDuration(avgMs))
    }</strong></div>
  `;

  if (selected) {
    const selectedMetrics = ensureStreamMetrics(selected);
    const selectedDuration =
      typeof selected.endedAt === "number" ? selected.endedAt - selected.startedAt : null;
    const selectedBlock = document.createElement("div");
    selectedBlock.className = "stats-selected";
    selectedBlock.innerHTML = `
      <div class="stats-subtitle">${escapeHtml(t("statsSelectedStream"))}</div>
      <div class="stats-row"><span>${escapeHtml(t("statsSelectedEvents"))}</span><strong>${selected.events.length}</strong></div>
      <div class="stats-row"><span>${escapeHtml(t("statsSelectedDuration"))}</span><strong>${
        selectedDuration == null ? "—" : escapeHtml(formatDuration(selectedDuration))
      }</strong></div>
      <div class="stats-row"><span>${escapeHtml(t("statsSelectedTtft"))}</span><strong>${escapeHtml(formatMetricMs(selectedMetrics.ttftMs))}</strong></div>
      <div class="stats-row"><span>${escapeHtml(t("statsSelectedAvgGap"))}</span><strong>${escapeHtml(formatMetricMs(selectedMetrics.avgGapMs))}</strong></div>
      <div class="stats-row"><span>${escapeHtml(t("statsSelectedP95Gap"))}</span><strong>${escapeHtml(formatMetricMs(selectedMetrics.p95GapMs))}</strong></div>
      <div class="stats-row"><span>${escapeHtml(t("statsSelectedEventsPerSec"))}</span><strong>${
        selectedMetrics.eventsPerSec == null ? "—" : escapeHtml(String(selectedMetrics.eventsPerSec))
      }</strong></div>
    `;
    body.appendChild(selectedBlock);
  }

  openAppDialog(t("statsDialogTitle"), body);
}

function jumpToStreamEvent(requestId: string, eventIndex: number): void {
  const record = streams.get(requestId);
  if (!record) return;
  selectedId = requestId;
  selectedEventIndex = null;
  renderList();
  renderDetail();
  selectEventByIndex(record, eventIndex);
}

function showAnomaliesDialog(): void {
  const all = Array.from(streams.values())
    .map((record) => ({ record, anomalies: scanStreamAnomalies(record) }))
    .filter((item) => item.anomalies.length > 0)
    .sort((a, b) => b.record.startedAt - a.record.startedAt);

  const body = document.createElement("div");
  body.className = "archives-panel";

  if (all.length === 0) {
    const empty = document.createElement("div");
    empty.className = "search-all-empty";
    empty.textContent = t("anomaliesEmpty");
    body.appendChild(empty);
    openAppDialog(t("anomaliesDialogTitle"), body);
    return;
  }

  const list = document.createElement("ul");
  list.className = "archives-list";
  for (const item of all) {
    const li = document.createElement("li");
    li.className = "archives-item";

    const meta = document.createElement("div");
    meta.className = "archives-meta";
    meta.innerHTML = `
      <div class="archives-name">${escapeHtml(shortPath(item.record.url))}</div>
      <div class="archives-sub">${escapeHtml(
        t("anomaliesCount", String(item.anomalies.length)),
      )}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "archives-actions";
    for (const anomaly of item.anomalies.slice(0, 8)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-all-item";
      btn.innerHTML = `
        <span class="search-all-item-main">#${anomaly.eventIndex} · ${escapeHtml(
          anomalyKindLabel(anomaly.kind),
        )}</span>
        <span class="search-all-item-sub">${escapeHtml(anomaly.message)}</span>
      `;
      btn.addEventListener("click", () => {
        closeAppDialog();
        jumpToStreamEvent(item.record.requestId, anomaly.eventIndex);
      });
      actions.appendChild(btn);
    }
    li.append(meta, actions);
    list.appendChild(li);
  }
  body.appendChild(list);
  openAppDialog(t("anomaliesDialogTitle"), body);
}

function showSpecWarningsDialog(): void {
  const all = Array.from(streams.values())
    .map((record) => ({ record, warnings: getStreamSpecWarnings(record) }))
    .filter((item) => item.warnings.length > 0)
    .sort((a, b) => b.record.startedAt - a.record.startedAt);

  const body = document.createElement("div");
  body.className = "archives-panel";

  if (all.length === 0) {
    const empty = document.createElement("div");
    empty.className = "search-all-empty";
    empty.textContent = t("specWarningsEmpty");
    body.appendChild(empty);
    openAppDialog(t("specWarningsDialogTitle"), body);
    return;
  }

  const list = document.createElement("ul");
  list.className = "archives-list";
  for (const item of all) {
    const li = document.createElement("li");
    li.className = "archives-item";

    const meta = document.createElement("div");
    meta.className = "archives-meta";
    meta.innerHTML = `
      <div class="archives-name">${escapeHtml(shortPath(item.record.url))}</div>
      <div class="archives-sub">${escapeHtml(
        t("specWarningsCount", String(item.warnings.length)),
      )}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "archives-actions";
    for (const warning of item.warnings.slice(0, 12)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-all-item";
      const indexLabel =
        typeof warning.eventIndex === "number" ? `#${warning.eventIndex}` : t("specStreamLevel");
      btn.innerHTML = `
        <span class="search-all-item-main">${escapeHtml(indexLabel)} · ${escapeHtml(
          specWarningKindLabel(warning.kind),
        )}</span>
        <span class="search-all-item-sub">${escapeHtml(specWarningMessage(warning))}</span>
      `;
      btn.addEventListener("click", () => {
        closeAppDialog();
        if (typeof warning.eventIndex === "number") {
          jumpToStreamEvent(item.record.requestId, warning.eventIndex);
        } else {
          selectedId = item.record.requestId;
          selectedEventIndex = null;
          renderList();
          renderDetail();
        }
      });
      actions.appendChild(btn);
    }
    li.append(meta, actions);
    list.appendChild(li);
  }
  body.appendChild(list);
  openAppDialog(t("specWarningsDialogTitle"), body);
}

function showGlobalSearchDialog(): void {
  const body = document.createElement("div");
  body.className = "search-all-panel";

  const input = document.createElement("input");
  input.className = "action-input";
  input.type = "search";
  input.placeholder = t("searchAllPlaceholder");
  input.autocomplete = "off";
  input.spellcheck = false;

  const results = document.createElement("div");
  results.className = "search-all-results";

  const renderResults = (query: string): void => {
    results.innerHTML = "";
    const filter = compileTextFilter(query);
    if (filter.isEmpty) {
      const empty = document.createElement("div");
      empty.className = "search-all-empty";
      empty.textContent = t("searchAllHint");
      results.appendChild(empty);
      return;
    }
    const matches: Array<{ requestId: string; url: string; event: SseEvent }> = [];
    for (const record of Array.from(streams.values()).sort((a, b) => b.startedAt - a.startedAt)) {
      for (const ev of record.events) {
        if (filter.test(ev.event) || filter.test(ev.data)) {
          matches.push({ requestId: record.requestId, url: record.url, event: ev });
          if (matches.length >= 200) break;
        }
      }
      if (matches.length >= 200) break;
    }
    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "search-all-empty";
      empty.textContent = t("searchAllNoResults");
      results.appendChild(empty);
      return;
    }
    for (const match of matches) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-all-item";
      btn.innerHTML = `
        <span class="search-all-item-main">${escapeHtml(shortPath(match.url))} · #${
          match.event.index
        } · ${escapeHtml(match.event.event)}</span>
        <span class="search-all-item-sub">${escapeHtml(previewData(match.event.data))}</span>
      `;
      btn.addEventListener("click", () => {
        closeAppDialog();
        jumpToStreamEvent(match.requestId, match.event.index);
      });
      results.appendChild(btn);
    }
  };

  input.addEventListener("input", () => {
    renderResults(input.value);
  });

  body.append(input, results);
  openAppDialog(t("searchAllDialogTitle"), body);
  input.focus();
  renderResults("");
}

async function showArchivesDialog(): Promise<void> {
  const entries = await listStreamArchives();
  const body = document.createElement("div");
  body.className = "archives-panel";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "archives-empty";
    empty.textContent = t("archivesEmpty");
    body.appendChild(empty);
  } else {
    const list = document.createElement("ul");
    list.className = "archives-list";
    for (const entry of entries) {
      list.appendChild(createArchiveListItem(entry));
    }
    body.appendChild(list);
  }

  openAppDialog(t("archivesDialogTitle"), body);
}

function createArchiveListItem(entry: StreamArchiveEntry): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "archives-item";
  const meta = document.createElement("div");
  meta.className = "archives-meta";
  meta.innerHTML = `
    <div class="archives-name">${escapeHtml(entry.name)}</div>
    <div class="archives-sub">
      ${escapeHtml(new Date(entry.savedAt).toLocaleString())}
      · ${escapeHtml(t("eventsCount", String(entry.stream.events.length)))}
      · ${escapeHtml(shortPath(entry.stream.url))}
    </div>
  `;
  const actions = document.createElement("div");
  actions.className = "archives-actions";

  const loadBtn = document.createElement("button");
  loadBtn.type = "button";
  loadBtn.textContent = t("archiveLoad");
  loadBtn.addEventListener("click", async () => {
    const latest = await getStreamArchive(entry.id);
    if (!latest) {
      window.alert(t("archiveMissing"));
      await showArchivesDialog();
      return;
    }
    const record = {
      ...latest.stream,
      events: latest.stream.events.map((ev) => ({ ...ev })),
      requestId: createRequestId("arc"),
      origin: "archive" as const,
      streamStatus: latest.stream.streamStatus === "streaming" ? ("done" as const) : latest.stream.streamStatus,
    };
    addStaticStream(record);
    closeAppDialog();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = t("archiveDelete");
  deleteBtn.addEventListener("click", async () => {
    if (!window.confirm(t("archiveDeleteConfirm", entry.name))) return;
    await deleteStreamArchive(entry.id);
    await showArchivesDialog();
  });

  actions.append(loadBtn, deleteBtn);
  li.append(meta, actions);
  return li;
}

function originLabel(origin: StreamRecord["origin"]): string | null {
  if (origin === "imported") return t("originImported");
  if (origin === "archive") return t("originArchive");
  return null;
}

function statusLabel(status: StreamRecord["streamStatus"]): string {
  switch (status) {
    case "streaming":
      return t("statusStreaming");
    case "done":
      return t("statusDone");
    case "error":
      return t("statusError");
    default:
      return status;
  }
}

function transportLabel(transport: StreamTransport): string {
  switch (transport) {
    case "fetch":
      return t("transportFetch");
    case "eventsource":
      return t("transportEventSource");
    case "xhr":
      return t("transportXhr");
    default:
      return transport;
  }
}

let listRenderScheduled = false;
let detailRenderScheduled = false;
let detailRenderAppendFriendly = false;

function scheduleRenderList(): void {
  if (listRenderScheduled) return;
  listRenderScheduled = true;
  requestAnimationFrame(() => {
    listRenderScheduled = false;
    renderList();
  });
}

function scheduleRenderDetail(appendFriendly = false): void {
  detailRenderAppendFriendly = detailRenderAppendFriendly || appendFriendly;
  if (detailRenderScheduled) return;
  detailRenderScheduled = true;
  requestAnimationFrame(() => {
    detailRenderScheduled = false;
    const append = detailRenderAppendFriendly;
    detailRenderAppendFriendly = false;
    renderDetail(append);
  });
}

function streamItemFingerprint(s: StreamRecord): string {
  return [
    s.requestId === selectedId ? "1" : "0",
    s.streamStatus,
    s.transport,
    s.origin ?? "",
    String(s.status ?? ""),
    String(s.events.length),
    s.method,
    s.url,
  ].join("|");
}

function renderList(): void {
  const urlFilter = streamsUrlFilterQuery.trim().toLowerCase();
  const items = Array.from(streams.values())
    .filter((s) => {
      if (streamsTransportFilter !== "all" && s.transport !== streamsTransportFilter) return false;
      if (!urlFilter) return true;
      return s.url.toLowerCase().includes(urlFilter);
    })
    .sort((a, b) => a.startedAt - b.startedAt);
  elEmpty.classList.toggle("hidden", items.length > 0);
  if (items.length === 0 && streams.size > 0 && (urlFilter || streamsTransportFilter !== "all")) {
    elEmpty.textContent = t("noStreamsMatchFilter");
  } else {
    elEmpty.innerHTML = `
      <span>${escapeHtml(t("emptyWaitingBefore"))}</span>
      <code>text/event-stream</code><span>${escapeHtml(t("emptyWaitingAfter"))}</span>
      <br />
      <span>${escapeHtml(t("emptyRefresh"))}</span>
    `;
  }

  const seen = new Set<string>();
  for (const s of items) {
    seen.add(s.requestId);
    const fingerprint = streamItemFingerprint(s);
    const anomalyCount = scanStreamAnomalies(s).length;
    const specCount = getStreamSpecWarnings(s).length;
    let li = elList.querySelector<HTMLLIElement>(`li[data-id="${CSS.escape(s.requestId)}"]`);
    if (!li) {
      li = document.createElement("li");
      li.dataset.id = s.requestId;
      elList.appendChild(li);
    }
    li.className = "stream-item" + (s.requestId === selectedId ? " active" : "");
    if (li.dataset.fingerprint !== fingerprint) {
      li.dataset.fingerprint = fingerprint;
      li.innerHTML = `
        <div><span class="method">${escapeHtml(s.method)}</span><span class="path">${escapeHtml(shortPath(s.url))}</span></div>
        <div class="status-row">
          <span class="badge ${s.streamStatus}">${escapeHtml(statusLabel(s.streamStatus))}</span>
          <span class="badge">${escapeHtml(transportLabel(s.transport))}</span>
          ${
            originLabel(s.origin)
              ? `<span class="badge origin">${escapeHtml(originLabel(s.origin) as string)}</span>`
              : ""
          }
          ${anomalyCount > 0 ? `<span class="badge warn" title="${escapeHtml(t("anomaliesTitle"))}">!${anomalyCount}</span>` : ""}
          ${specCount > 0 ? `<span class="badge spec" title="${escapeHtml(t("specWarningsTitle"))}">S${specCount}</span>` : ""}
          <span>${s.status ?? "—"}</span>
          <span>${escapeHtml(t("eventsCount", String(s.events.length)))}</span>
        </div>
      `;
    }
  }

  for (const node of Array.from(elList.children)) {
    const li = node as HTMLLIElement;
    const id = li.dataset.id;
    if (!id || !seen.has(id)) {
      li.remove();
    }
  }

  // Keep DOM order aligned with sorted items without full rebuild.
  for (let i = 0; i < items.length; i++) {
    const li = elList.querySelector<HTMLLIElement>(`li[data-id="${CSS.escape(items[i].requestId)}"]`);
    if (!li) continue;
    if (elList.children[i] !== li) {
      elList.insertBefore(li, elList.children[i] ?? null);
    }
  }
}

function renderDetail(appendFriendly = false): void {
  const record = selectedId ? streams.get(selectedId) : undefined;
  if (!record) {
    renderStreamMeta(undefined);
    elPlaceholder.hidden = false;
    elPlaceholder.textContent = t("noStreamSelected");
    elTableWrap.hidden = true;
    elTbody.innerHTML = "";
    closeDrawer();
    elRaw.textContent = "";
    renderTimeline(undefined);
    return;
  }

  renderStreamMeta(record);
  elRaw.textContent = record.raw || "";

  renderEvents(record, appendFriendly);
  renderTimeline(record);

  if (activeTab === "raw") {
    elRaw.scrollTop = elRaw.scrollHeight;
  }
}

function renderEvents(record: StreamRecord, appendFriendly: boolean): void {
  if (record.events.length === 0) {
    elPlaceholder.hidden = false;
    elPlaceholder.textContent = t("noEventsYet");
    elTableWrap.hidden = true;
    elTbody.innerHTML = "";
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

  if (selectedEventIndex != null) {
    const ev = record.events.find((e) => e.index === selectedEventIndex);
    if (ev) {
      openDrawer(ev);
    } else {
      closeDrawer();
    }
  } else {
    closeDrawer();
  }

  if (activeTab === "events" && appendFriendly && !eventsSearchQuery.trim()) {
    elTableWrap.scrollTop = elTableWrap.scrollHeight;
  }
}

function applyEventsFilter(): void {
  const record = selectedId ? streams.get(selectedId) : undefined;
  if (!record) return;

  let visible = 0;
  elTbody.querySelectorAll("tr").forEach((tr) => {
    const idx = Number(tr.getAttribute("data-index"));
    const ev = record.events.find((e) => e.index === idx);
    const show = ev ? eventMatchesSearch(ev, eventsSearchQuery) : false;
    tr.hidden = !show;
    if (show) visible += 1;
  });

  if (record.events.length > 0 && visible === 0 && eventsSearchQuery.trim()) {
    elPlaceholder.hidden = false;
    elPlaceholder.textContent = t("noEventsMatch");
    // keep table visible so clearing search restores rows without rebuild
  } else if (record.events.length > 0) {
    elPlaceholder.hidden = true;
  }
}

function createEventRow(ev: SseEvent): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.dataset.index = String(ev.index);
  tr.hidden = !eventMatchesSearch(ev, eventsSearchQuery);
  const record = selectedId ? streams.get(selectedId) : undefined;
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
    <td class="col-index">${ev.index}${warnMark}</td>
    <td class="col-time">${escapeHtml(formatTime(ev.receivedAt))}</td>
    <td class="col-event">${escapeHtml(ev.event)}</td>
    <td class="col-data" title="${escapeHtml(ev.data)}">${escapeHtml(previewData(ev.data))}</td>
  `;
  tr.addEventListener("click", () => {
    hideContextMenu();
    if (selectedEventIndex === ev.index) {
      selectedEventIndex = null;
      closeDrawer();
      syncRowSelection();
      return;
    }
    selectedEventIndex = ev.index;
    syncRowSelection();
    openDrawer(ev);
  });
  tr.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, ev.data);
  });
  return tr;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function showContextMenu(x: number, y: number, data: string): void {
  contextMenuData = data;
  elContextMenu.hidden = false;
  const pad = 4;
  const menuW = elContextMenu.offsetWidth || 140;
  const menuH = elContextMenu.offsetHeight || 36;
  const left = Math.min(x, window.innerWidth - menuW - pad);
  const top = Math.min(y, window.innerHeight - menuH - pad);
  elContextMenu.style.left = `${Math.max(pad, left)}px`;
  elContextMenu.style.top = `${Math.max(pad, top)}px`;
}

function hideContextMenu(): void {
  elContextMenu.hidden = true;
  contextMenuData = null;
}

function syncRowSelection(): void {
  elTbody.querySelectorAll("tr").forEach((tr) => {
    const idx = Number(tr.getAttribute("data-index"));
    tr.classList.toggle("selected", idx === selectedEventIndex);
  });
}

function applyDrawerWidth(): void {
  elEvents.style.setProperty("--events-drawer-width", `${drawerWidthPercent}%`);
}

function openDrawer(ev: SseEvent): void {
  const sameEvent = drawerEventIndex === ev.index && !elDrawer.hidden;
  elDrawer.hidden = false;
  elResizer.hidden = false;
  elEvents.classList.add("drawer-open");
  applyDrawerWidth();
  drawerEventData = ev.data;
  drawerEventIndex = ev.index;
  elDrawerTitle.textContent = `#${ev.index} · ${ev.event}`;
  updateDrawerNavButtons();

  // Avoid wiping drawer search / rebuild when streaming updates the same open event
  if (sameEvent && elDrawerBody.querySelector(".json-tree, .event-body-text")) {
    applyDrawerSearch();
    return;
  }

  elDrawerBody.innerHTML = "";

  const record = selectedId ? streams.get(selectedId) : undefined;
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
    elDrawerBody.appendChild(createJsonTree(parsed.value, { defaultExpandDepth: 2 }));
  } else {
    const pre = document.createElement("pre");
    pre.className = "event-body-text";
    pre.textContent = ev.data;
    elDrawerBody.appendChild(pre);
  }
  applyDrawerSearch();
}

function applyDrawerSearch(): void {
  const tree = elDrawerBody.querySelector<HTMLElement>(".json-tree");
  if (tree) {
    applyTreeSearch(tree, drawerSearchQuery);
    return;
  }

  const pre = elDrawerBody.querySelector<HTMLPreElement>(".event-body-text");
  if (!pre || drawerEventData == null) return;

  const filter = compileTextFilter(drawerSearchQuery);
  if (filter.isEmpty) {
    pre.textContent = drawerEventData;
    pre.classList.remove("search-no-match");
    return;
  }

  if (!filter.test(drawerEventData)) {
    pre.textContent = t("noMatches");
    pre.classList.add("search-no-match");
    return;
  }

  pre.classList.remove("search-no-match");
  pre.textContent = "";
  const ranges = filter.matchRanges(drawerEventData);
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      pre.appendChild(document.createTextNode(drawerEventData.slice(cursor, range.start)));
    }
    const mark = document.createElement("mark");
    mark.className = "search-mark";
    mark.textContent = drawerEventData.slice(range.start, range.end);
    pre.appendChild(mark);
    cursor = range.end;
  }
  if (cursor < drawerEventData.length) {
    pre.appendChild(document.createTextNode(drawerEventData.slice(cursor)));
  }
}

function closeDrawer(): void {
  selectedEventIndex = null;
  drawerEventData = null;
  drawerEventIndex = null;
  elDrawer.hidden = true;
  elResizer.hidden = true;
  elEvents.classList.remove("drawer-open");
  elDrawerBody.innerHTML = "";
  elDrawerTitle.textContent = "";
  updateDrawerNavButtons();
  syncRowSelection();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function activateTab(tab: "events" | "raw" | "timeline"): void {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach((node) => {
    const btn = node as HTMLButtonElement;
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${tab}`)?.classList.add("active");
}

function jumpToSelectedEventFromTimeline(eventIndex: number): void {
  const record = selectedId ? streams.get(selectedId) : undefined;
  if (!record) return;
  activateTab("events");
  selectEventByIndex(record, eventIndex);
}

const TIMELINE_STALL_MS = 250;

function renderTimeline(record: StreamRecord | undefined): void {
  if (!record) {
    elTimelinePlaceholder.hidden = false;
    elTimelinePlaceholder.textContent = t("noStreamSelected");
    elTimelineBody.hidden = true;
    elTimelineBody.innerHTML = "";
    return;
  }

  if (record.events.length === 0) {
    elTimelinePlaceholder.hidden = false;
    elTimelinePlaceholder.textContent = t("noEventsYet");
    elTimelineBody.hidden = true;
    elTimelineBody.innerHTML = "";
    return;
  }

  elTimelinePlaceholder.hidden = true;
  elTimelineBody.hidden = false;
  elTimelineBody.innerHTML = "";

  const origin = record.startedAt;
  const marks = buildTimelineMarks(record.events, origin);
  const spanMs = Math.max(timelineSpanMs(marks), 1);
  const gaps = collectEventGaps(record.events);
  const metrics = ensureStreamMetrics(record);

  const meta = document.createElement("div");
  meta.className = "timeline-meta";
  meta.textContent = t("timelineMeta", [
    String(record.events.length),
    formatMetricMs(metrics.durationMs ?? spanMs),
    formatMetricMs(metrics.p95GapMs),
  ]);
  elTimelineBody.appendChild(meta);

  const trackSection = document.createElement("section");
  trackSection.className = "timeline-section";
  const trackTitle = document.createElement("div");
  trackTitle.className = "timeline-section-title";
  trackTitle.textContent = t("timelineTrackTitle");
  const trackHint = document.createElement("div");
  trackHint.className = "timeline-section-hint";
  trackHint.textContent = t("timelineTrackHint");
  trackSection.append(trackTitle, trackHint);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "timeline-track-svg");
  svg.setAttribute("viewBox", "0 0 640 72");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("timelineTrackTitle"));

  const padL = 16;
  const padR = 16;
  const trackY = 28;
  const plotW = 640 - padL - padR;

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("class", "track-line");
  line.setAttribute("x1", String(padL));
  line.setAttribute("y1", String(trackY));
  line.setAttribute("x2", String(padL + plotW));
  line.setAttribute("y2", String(trackY));
  svg.appendChild(line);

  for (const mark of marks) {
    const x = padL + (mark.offsetMs / spanMs) * plotW;
    const isStall = typeof mark.gapFromPrevMs === "number" && mark.gapFromPrevMs >= TIMELINE_STALL_MS;
    const isSelected = selectedEventIndex === mark.index;
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    tick.setAttribute(
      "class",
      `tick${isSelected ? " is-selected" : ""}${isStall && !isSelected ? " is-stall" : ""}`,
    );
    tick.setAttribute("x", String(x - 2));
    tick.setAttribute("y", String(trackY - 14));
    tick.setAttribute("width", "4");
    tick.setAttribute("height", "28");
    tick.setAttribute("rx", "1");
    tick.setAttribute("data-index", String(mark.index));
    tick.setAttribute(
      "title",
      `#${mark.index} · ${mark.event} · +${Math.round(mark.offsetMs)}ms` +
        (mark.gapFromPrevMs != null ? ` · gap ${Math.round(mark.gapFromPrevMs)}ms` : ""),
    );
    tick.addEventListener("click", () => {
      jumpToSelectedEventFromTimeline(mark.index);
    });
    svg.appendChild(tick);
  }

  const label0 = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label0.setAttribute("class", "axis-label");
  label0.setAttribute("x", String(padL));
  label0.setAttribute("y", "58");
  label0.textContent = "0";
  svg.appendChild(label0);

  const labelMid = document.createElementNS("http://www.w3.org/2000/svg", "text");
  labelMid.setAttribute("class", "axis-label");
  labelMid.setAttribute("x", String(padL + plotW / 2));
  labelMid.setAttribute("y", "58");
  labelMid.setAttribute("text-anchor", "middle");
  labelMid.textContent = formatMetricMs(spanMs / 2);
  svg.appendChild(labelMid);

  const labelEnd = document.createElementNS("http://www.w3.org/2000/svg", "text");
  labelEnd.setAttribute("class", "axis-label");
  labelEnd.setAttribute("x", String(padL + plotW));
  labelEnd.setAttribute("y", "58");
  labelEnd.setAttribute("text-anchor", "end");
  labelEnd.textContent = formatMetricMs(spanMs);
  svg.appendChild(labelEnd);

  trackSection.appendChild(svg);
  elTimelineBody.appendChild(trackSection);

  const histSection = document.createElement("section");
  histSection.className = "timeline-section";
  const histTitle = document.createElement("div");
  histTitle.className = "timeline-section-title";
  histTitle.textContent = t("timelineGapHistogram");
  const histHint = document.createElement("div");
  histHint.className = "timeline-section-hint";
  histHint.textContent = t("timelineGapHistogramHint");
  histSection.append(histTitle, histHint);
  if (gaps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline-meta";
    empty.textContent = t("timelineGapHistogramEmpty");
    histSection.appendChild(empty);
  } else {
    histSection.appendChild(createGapHistogramSvg(buildGapHistogram(gaps)));
  }
  elTimelineBody.appendChild(histSection);

  const gapBox = document.createElement("section");
  gapBox.className = "timeline-section timeline-gaps";
  const gapTitle = document.createElement("div");
  gapTitle.className = "timeline-section-title";
  gapTitle.textContent = t("timelineLargestGaps");
  const gapHint = document.createElement("div");
  gapHint.className = "timeline-section-hint";
  gapHint.textContent = t("timelineLargestGapsHint");
  gapBox.append(gapTitle, gapHint);

  const topGaps = largestGaps(gaps, 5);
  if (topGaps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline-meta";
    empty.textContent = t("timelineNoGaps");
    gapBox.appendChild(empty);
  } else {
    for (const gap of topGaps) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "timeline-gap-item";
      btn.innerHTML = `
        <span>${escapeHtml(t("timelineGapBeforeEvent", String(gap.afterIndex)))}</span>
        <strong>${escapeHtml(formatMetricMs(gap.gapMs))}</strong>
      `;
      btn.addEventListener("click", () => {
        jumpToSelectedEventFromTimeline(gap.afterIndex);
      });
      gapBox.appendChild(btn);
    }
  }
  elTimelineBody.appendChild(gapBox);
}

function setupTabs(): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as typeof activeTab;
      if (tab !== "events" && tab !== "raw" && tab !== "timeline") return;
      activateTab(tab);
      if (tab === "timeline") {
        const record = selectedId ? streams.get(selectedId) : undefined;
        renderTimeline(record);
      }
    });
  });
}

function setupActions(): void {
  // Prefer pointerdown: XHR streaming may rewrite row contents between mousedown/mouseup.
  elList.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const li = (e.target as HTMLElement | null)?.closest("li.stream-item");
    if (!(li instanceof HTMLLIElement) || !elList.contains(li)) return;
    const id = li.dataset.id;
    if (!id || !streams.has(id) || id === selectedId) return;
    selectedId = id;
    selectedEventIndex = null;
    renderList();
    renderDetail();
  });

  document.getElementById("btn-clear")?.addEventListener("click", () => {
    streams.clear();
    parsers.clear();
    anomalyCache.clear();
    specWarningCache.clear();
    selectedId = null;
    selectedEventIndex = null;
    streamsUrlFilterQuery = "";
    streamsTransportFilter = "all";
    pendingListRefreshWhilePaused = false;
    pendingDetailRefreshWhilePaused = false;
    elStreamsUrlFilter.value = "";
    elStreamsTransportFilter.value = "all";
    renderList();
    renderDetail();
  });

  elExportJson.addEventListener("click", () => {
    exportSelectedStreamJson();
  });

  elExportCsv.addEventListener("click", () => {
    exportSelectedStreamCsv();
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
    void importStreamFromFile(file).catch((err) => {
      window.alert(t("importFailed", err instanceof Error ? err.message : String(err)));
    });
  });

  elSaveArchive.addEventListener("click", () => {
    void saveSelectedStreamArchive().catch((err) => {
      window.alert(t("archiveSaveFailed", err instanceof Error ? err.message : String(err)));
    });
  });

  elArchives.addEventListener("click", () => {
    void showArchivesDialog().catch((err) => {
      window.alert(t("archivesOpenFailed", err instanceof Error ? err.message : String(err)));
    });
  });

  elStats.addEventListener("click", () => {
    showStatsDialog();
  });

  elAnomalies.addEventListener("click", () => {
    showAnomaliesDialog();
  });

  elSpecWarnings.addEventListener("click", () => {
    showSpecWarningsDialog();
  });

  elSearchAll.addEventListener("click", () => {
    showGlobalSearchDialog();
  });

  elPauseUi.addEventListener("click", () => {
    setUiPaused(!uiPaused);
  });

  elDialogClose.addEventListener("click", () => {
    closeAppDialog();
  });

  elDialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeAppDialog();
  });

  document.getElementById("btn-copy-raw")?.addEventListener("click", async () => {
    const record = selectedId ? streams.get(selectedId) : undefined;
    if (!record) return;
    await copyText(record.raw);
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
    if (drawerEventData == null) return;
    await copyText(drawerEventData);
  });

  elEventsSearch.addEventListener("input", () => {
    eventsSearchQuery = elEventsSearch.value;
    applyEventsFilter();
    updateDrawerNavButtons();
  });

  elStreamsUrlFilter.addEventListener("input", () => {
    streamsUrlFilterQuery = elStreamsUrlFilter.value;
    renderList();
  });

  elStreamsTransportFilter.addEventListener("change", () => {
    const value = elStreamsTransportFilter.value;
    streamsTransportFilter =
      value === "fetch" || value === "eventsource" || value === "xhr" ? value : "all";
    renderList();
  });

  elDrawerSearch.addEventListener("input", () => {
    drawerSearchQuery = elDrawerSearch.value;
    applyDrawerSearch();
  });

  elContextMenu.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest("button[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "copy-data" && contextMenuData != null) {
      await copyText(contextMenuData);
    }
    hideContextMenu();
  });

  document.addEventListener("click", () => hideContextMenu());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideContextMenu();
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
  window.addEventListener("blur", () => hideContextMenu());
  elTableWrap.addEventListener("scroll", () => hideContextMenu());
}

function setupResizer(): void {
  applyDrawerWidth();

  elResizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const rect = elEvents.getBoundingClientRect();
      if (rect.width <= 0) return;
      const fromRight = ((rect.right - ev.clientX) / rect.width) * 100;
      drawerWidthPercent = Math.min(DRAWER_WIDTH_MAX, Math.max(DRAWER_WIDTH_MIN, fromRight));
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
setupResizer();
initEventsColumnResizers(document.getElementById("events-table") as HTMLTableElement);

function refreshLocaleUi(): void {
  document.documentElement.lang = uiLanguage();
  document.title = t("panelTitle");
  applyDomI18n();
  setUiPaused(uiPaused);
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
