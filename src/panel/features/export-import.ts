import { t } from "../../shared/i18n";
import { saveStreamArchive } from "../../shared/stream-archive-db";
import {
  buildSseFixture,
  buildStreamExportCsv,
  buildStreamExportPayload,
  createRequestId,
  parseStreamExportJson,
  streamRecordFromExport,
} from "../../shared/stream-snapshot";
import type { SseEvent, StreamRecord } from "../../shared/types";
import { buildExportFilename, shortPath } from "../core/format";
import { state } from "../core/state";
import { downloadTextFile, showToast } from "../core/ui-chrome";

export type ExportImportHooks = {
  getBrowsableEvents: (record: StreamRecord) => SseEvent[];
  renderList: () => void;
  renderDetail: (appendFriendly?: boolean) => void;
};

/** Export selected stream for sharing / repro. */
export function exportSelectedStreamJson(): void {
  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
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
  showToast(t("toastExportedJson"));
}

/** CSV export; respects current Events search filter. */
export function exportSelectedStreamCsv(hooks: ExportImportHooks): void {
  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
  if (!record) {
    window.alert(t("needSelectedStream"));
    return;
  }
  const visible = hooks.getBrowsableEvents(record);
  if (visible.length === 0) {
    window.alert(t("exportCsvEmpty"));
    return;
  }
  downloadTextFile(
    buildExportFilename(record, "csv"),
    buildStreamExportCsv(record, visible),
    "text/csv;charset=utf-8",
  );
  showToast(t("toastExportedCsv", String(visible.length)));
}

/** Rebuild text/event-stream fixture from parsed events. */
export function exportSelectedStreamFixture(): void {
  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
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
  showToast(t("toastExportedFixture"));
}

export function addStaticStream(record: StreamRecord, hooks: ExportImportHooks): void {
  state.streams.set(record.requestId, record);
  state.parsers.delete(record.requestId);
  state.selectedId = record.requestId;
  state.selectedEventIndex = null;
  hooks.renderList();
  hooks.renderDetail();
}

export async function importStreamFromFile(file: File, hooks: ExportImportHooks): Promise<void> {
  const text = await file.text();
  const body = parseStreamExportJson(text);
  const record = streamRecordFromExport(body, {
    requestId: createRequestId("imp"),
    origin: "imported",
  });
  addStaticStream(record, hooks);
}

export async function saveSelectedStreamArchive(): Promise<void> {
  const record = state.selectedId ? state.streams.get(state.selectedId) : undefined;
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
  showToast(t("toastArchiveSaved"));
}
