import { t } from "../../shared/i18n";
import {
  buildGapHistogram,
  buildTimelineMarks,
  collectEventGaps,
  largestGaps,
  timelineSpanMs,
  type HistogramBin,
} from "../../shared/stream-timing";
import type { StreamRecord } from "../../shared/types";
import { elTimelineBody, elTimelinePlaceholder } from "../core/dom";
import { escapeHtml, formatGapBinLabel, formatMetricMs } from "../core/format";
import { ensureStreamMetrics } from "../features/stream-metrics";

export const TIMELINE_STALL_MS = 250;

export type RenderTimelineOptions = {
  selectedEventIndex: number | null;
  onJumpToEvent: (eventIndex: number) => void;
};

export function createGapHistogramSvg(bins: HistogramBin[]): SVGSVGElement {
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

export function renderTimeline(
  record: StreamRecord | undefined,
  options: RenderTimelineOptions,
): void {
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
  const reconnects = record.reconnects ?? [];
  const reconnectMaxOffset = reconnects.reduce((max, item) => {
    const offset = item.at - origin;
    return Number.isFinite(offset) && offset > max ? offset : max;
  }, 0);
  const spanMs = Math.max(timelineSpanMs(marks), reconnectMaxOffset, 1);
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
    const isStall =
      typeof mark.gapFromPrevMs === "number" && mark.gapFromPrevMs >= TIMELINE_STALL_MS;
    const isSelected = options.selectedEventIndex === mark.index;
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
      options.onJumpToEvent(mark.index);
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

  if (reconnects.length > 0) {
    for (const reconnect of reconnects) {
      const offsetMs = Math.max(0, reconnect.at - origin);
      const x = padL + (Math.min(offsetMs, spanMs) / spanMs) * plotW;
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      marker.setAttribute("class", "reconnect-mark");
      marker.setAttribute(
        "points",
        `${x},${trackY - 20} ${x + 5},${trackY - 10} ${x},${trackY} ${x - 5},${trackY - 10}`,
      );
      marker.setAttribute(
        "title",
        t("timelineReconnectMark", [
          String(reconnect.reconnectCount),
          reconnect.lastEventId ? reconnect.lastEventId : "—",
          `+${Math.round(offsetMs)}ms`,
        ]),
      );
      svg.appendChild(marker);
    }

    const reconnectSection = document.createElement("section");
    reconnectSection.className = "timeline-section timeline-reconnects";
    const reconnectTitle = document.createElement("div");
    reconnectTitle.className = "timeline-section-title";
    reconnectTitle.textContent = t("timelineReconnectsTitle");
    const reconnectHint = document.createElement("div");
    reconnectHint.className = "timeline-section-hint";
    reconnectHint.textContent = t("timelineReconnectsHint");
    reconnectSection.append(reconnectTitle, reconnectHint);

    for (const reconnect of reconnects) {
      const row = document.createElement("div");
      row.className = "timeline-reconnect-item";
      const offsetMs = Math.max(0, reconnect.at - origin);
      row.innerHTML = `
        <span>${escapeHtml(t("timelineReconnectItem", String(reconnect.reconnectCount)))}</span>
        <span>${escapeHtml(`+${Math.round(offsetMs)}ms`)}</span>
        <code>${escapeHtml(reconnect.lastEventId || "—")}</code>
      `;
      reconnectSection.appendChild(row);
    }
    elTimelineBody.appendChild(reconnectSection);
  }

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
        options.onJumpToEvent(gap.afterIndex);
      });
      gapBox.appendChild(btn);
    }
  }
  elTimelineBody.appendChild(gapBox);
}
