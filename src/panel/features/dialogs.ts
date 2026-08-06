import { t } from "../../shared/i18n";
import { compileTextFilter } from "../../shared/text-filter";
import {
  deleteStreamArchive,
  getStreamArchive,
  listStreamArchives,
  type StreamArchiveEntry,
} from "../../shared/stream-archive-db";
import { createRequestId } from "../../shared/stream-snapshot";
import type { SseEvent, StreamRecord } from "../../shared/types";
import { escapeHtml, formatDuration, formatMetricMs, previewData, shortPath } from "../core/format";
import { ensureStreamMetrics } from "./stream-metrics";
import {
  anomalyKindLabel,
  getStreamSpecWarnings,
  scanStreamAnomalies,
  specWarningKindLabel,
  specWarningMessage,
} from "./stream-anomalies";
import { state } from "../core/state";
import { closeAppDialog, openAppDialog } from "../core/ui-chrome";

export type DialogHooks = {
  renderList: () => void;
  renderDetail: (appendFriendly?: boolean) => void;
  activateTab: (tab: "events") => void;
  selectEventByIndex: (
    record: StreamRecord,
    index: number,
    options?: { scrollMode?: "nearest" | "start" },
  ) => void;
  addStaticStream: (record: StreamRecord) => void;
};

export function jumpToStreamEvent(requestId: string, eventIndex: number, hooks: DialogHooks): void {
  const record = state.streams.get(requestId);
  if (!record) return;
  state.selectedId = requestId;
  state.selectedEventIndex = null;
  hooks.renderList();
  hooks.renderDetail();
  // Keep global-search jump behavior stable even when user is on Timeline/Raw/Request.
  hooks.activateTab("events");
  hooks.selectEventByIndex(record, eventIndex, { scrollMode: "start" });
}

export function showStatsDialog(): void {
  const items = Array.from(state.streams.values());
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
  const selected = state.selectedId ? state.streams.get(state.selectedId) : undefined;

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
        selectedMetrics.eventsPerSec == null
          ? "—"
          : escapeHtml(String(selectedMetrics.eventsPerSec))
      }</strong></div>
    `;
    body.appendChild(selectedBlock);
  }

  openAppDialog(t("statsDialogTitle"), body);
}

export function showAnomaliesDialog(hooks: DialogHooks): void {
  const all = Array.from(state.streams.values())
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
        jumpToStreamEvent(item.record.requestId, anomaly.eventIndex, hooks);
      });
      actions.appendChild(btn);
    }
    li.append(meta, actions);
    list.appendChild(li);
  }
  body.appendChild(list);
  openAppDialog(t("anomaliesDialogTitle"), body);
}

export function showSpecWarningsDialog(hooks: DialogHooks): void {
  const all = Array.from(state.streams.values())
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
          jumpToStreamEvent(item.record.requestId, warning.eventIndex, hooks);
        } else {
          state.selectedId = item.record.requestId;
          state.selectedEventIndex = null;
          hooks.renderList();
          hooks.renderDetail();
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

export function showGlobalSearchDialog(hooks: DialogHooks): void {
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
    for (const record of Array.from(state.streams.values()).sort(
      (a, b) => b.startedAt - a.startedAt,
    )) {
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
        jumpToStreamEvent(match.requestId, match.event.index, hooks);
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

export async function showArchivesDialog(hooks: DialogHooks): Promise<void> {
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
      list.appendChild(createArchiveListItem(entry, hooks));
    }
    body.appendChild(list);
  }

  openAppDialog(t("archivesDialogTitle"), body);
}

export function createArchiveListItem(
  entry: StreamArchiveEntry,
  hooks: DialogHooks,
): HTMLLIElement {
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
      await showArchivesDialog(hooks);
      return;
    }
    const record = {
      ...latest.stream,
      events: latest.stream.events.map((ev) => ({ ...ev })),
      requestId: createRequestId("arc"),
      origin: "archive" as const,
      streamStatus:
        latest.stream.streamStatus === "streaming" ? ("done" as const) : latest.stream.streamStatus,
    };
    hooks.addStaticStream(record);
    closeAppDialog();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.textContent = t("archiveDelete");
  deleteBtn.addEventListener("click", async () => {
    if (!window.confirm(t("archiveDeleteConfirm", entry.name))) return;
    await deleteStreamArchive(entry.id);
    await showArchivesDialog(hooks);
  });

  actions.append(loadBtn, deleteBtn);
  li.append(meta, actions);
  return li;
}
