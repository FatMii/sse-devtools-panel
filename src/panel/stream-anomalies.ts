import { t } from "../shared/i18n";
import {
  scanStreamSpecWarnings,
  type SseSpecWarning,
  type SseSpecWarningKind,
} from "../shared/sse-spec";
import type { StreamRecord } from "../shared/types";

export type StreamAnomalyKind =
  "empty-data" | "json-parse-failed" | "duplicate-id" | "oversized-packet";

export type StreamAnomaly = {
  kind: StreamAnomalyKind;
  eventIndex: number;
  message: string;
};

export const OVERSIZED_PACKET_THRESHOLD = 16_000;

const anomalyCache = new Map<string, { eventCount: number; anomalies: StreamAnomaly[] }>();
const specWarningCache = new Map<
  string,
  { eventCount: number; rawLen: number; warnings: SseSpecWarning[] }
>();

export function clearStreamAnomalyCaches(): void {
  anomalyCache.clear();
  specWarningCache.clear();
}

export function invalidateStreamAnomalyCache(requestId: string): void {
  anomalyCache.delete(requestId);
  specWarningCache.delete(requestId);
}

export function anomalyKindLabel(kind: StreamAnomalyKind): string {
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

export function scanStreamAnomalies(record: StreamRecord): StreamAnomaly[] {
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

export function getStreamSpecWarnings(record: StreamRecord): SseSpecWarning[] {
  const cached = specWarningCache.get(record.requestId);
  if (cached && cached.eventCount === record.events.length && cached.rawLen === record.raw.length) {
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

export function specWarningKindLabel(kind: SseSpecWarningKind): string {
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

export function specWarningMessage(warning: SseSpecWarning): string {
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
