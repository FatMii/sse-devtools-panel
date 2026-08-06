import { t } from "../shared/i18n";
import type { StreamRecord } from "../shared/types";
import { elEmpty, elList, elStreamsCount } from "./dom";
import {
  closeReasonLabel,
  escapeHtml,
  originLabel,
  shortPath,
  streamStatusShort,
  transportLabel,
} from "./format";
import { getStreamSpecWarnings, scanStreamAnomalies } from "./stream-anomalies";
import { state } from "./state";

let listRenderScheduled = false;

export function scheduleRenderList(): void {
  if (listRenderScheduled) return;
  listRenderScheduled = true;
  requestAnimationFrame(() => {
    listRenderScheduled = false;
    renderList();
  });
}

export function streamItemFingerprint(s: StreamRecord): string {
  return [
    s.requestId === state.selectedId ? "1" : "0",
    s.streamStatus,
    s.transport,
    s.origin ?? "",
    String(s.status ?? ""),
    String(s.events.length),
    s.method,
    s.url,
    s.closeReason ?? "",
    String(s.reconnectCount ?? 0),
    s.lastEventId ?? "",
    s.errorMessage ?? "",
  ].join("|");
}

export function renderList(): void {
  const urlFilter = state.streamsUrlFilterQuery.trim().toLowerCase();
  const items = Array.from(state.streams.values())
    .filter((s) => {
      if (state.streamsTransportFilter !== "all" && s.transport !== state.streamsTransportFilter) {
        return false;
      }
      if (!urlFilter) return true;
      return s.url.toLowerCase().includes(urlFilter);
    })
    .sort((a, b) => a.startedAt - b.startedAt);
  elEmpty.classList.toggle("hidden", items.length > 0);
  if (elStreamsCount) {
    const filtered = Boolean(urlFilter) || state.streamsTransportFilter !== "all";
    elStreamsCount.textContent = filtered
      ? t("streamsCountFiltered", [String(items.length), String(state.streams.size)])
      : t("streamsCount", String(state.streams.size));
  }
  if (
    items.length === 0 &&
    state.streams.size > 0 &&
    (urlFilter || state.streamsTransportFilter !== "all")
  ) {
    elEmpty.textContent = t("noStreamsMatchFilter");
  } else {
    elEmpty.innerHTML = `
      <span>${escapeHtml(t("emptyWaitingBefore"))}</span>
      <code>text/event-stream</code><span>${escapeHtml(t("emptyWaitingAfter"))}</span>
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
    li.className = "stream" + (s.requestId === state.selectedId ? " active" : "");
    if (li.dataset.fingerprint !== fingerprint) {
      li.dataset.fingerprint = fingerprint;
      const transportClass =
        s.transport === "fetch" || s.transport === "xhr" || s.transport === "eventsource"
          ? s.transport
          : "";
      li.innerHTML = `
        <div class="stream-path"><span class="method">${escapeHtml(s.method)}</span>${escapeHtml(shortPath(s.url))}</div>
        <div class="stream-meta">
          <span class="badge ${transportClass}">${escapeHtml(transportLabel(s.transport))}</span>
          ${
            originLabel(s.origin)
              ? `<span class="badge origin">${escapeHtml(originLabel(s.origin) as string)}</span>`
              : ""
          }
          ${anomalyCount > 0 ? `<span class="badge warn" title="${escapeHtml(t("anomaliesTitle"))}">!${anomalyCount}</span>` : ""}
          ${specCount > 0 ? `<span class="badge spec" title="${escapeHtml(t("specWarningsTitle"))}">S${specCount}</span>` : ""}
          ${
            (s.reconnectCount ?? 0) > 0
              ? `<span class="badge reconnect" title="${escapeHtml(
                  t("reconnectBadgeTitle", String(s.reconnectCount)),
                )}">R${s.reconnectCount}</span>`
              : ""
          }
          ${
            s.closeReason === "abort"
              ? `<span class="badge abort" title="${escapeHtml(closeReasonLabel("abort"))}">${escapeHtml(
                  t("badgeAbort"),
                )}</span>`
              : ""
          }
          <span>${s.status != null ? `HTTP ${s.status}` : "—"}</span>
          <span>${escapeHtml(t("eventsCount", String(s.events.length)))}</span>
          <span class="status ${s.streamStatus}"><i></i>${escapeHtml(streamStatusShort(s.streamStatus))}</span>
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
    const li = elList.querySelector<HTMLLIElement>(
      `li[data-id="${CSS.escape(items[i].requestId)}"]`,
    );
    if (!li) continue;
    if (elList.children[i] !== li) {
      elList.insertBefore(li, elList.children[i] ?? null);
    }
  }
}
