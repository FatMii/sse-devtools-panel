import { t } from "../../shared/i18n";
import {
  buildGapHistogram,
  buildTimelineInsights,
  buildTimelineMarks,
  collectEventGaps,
  gapsInBin,
  isHotGapBin,
  isStallGapMs,
  largestGaps,
  TIMELINE_HOT_GAP_MS,
  TIMELINE_STALL_MS,
  timelineSpanMs,
  type GapSample,
  type HistogramBin,
  type TimelineInsight,
  type TimelineMark,
} from "../../shared/stream-timing";
import type { StreamRecord } from "../../shared/types";
import { elTimelineBody, elTimelinePlaceholder } from "../core/dom";
import { escapeHtml, formatGapBinLabel, formatMetricMs } from "../core/format";
import { ensureStreamMetrics } from "../features/stream-metrics";

/** Re-export for callers; single source of truth is stream-timing. */
export { TIMELINE_STALL_MS, TIMELINE_HOT_GAP_MS };

export type RenderTimelineOptions = {
  selectedEventIndex: number | null;
  onJumpToEvent: (eventIndex: number) => void;
};

type HistOptions = {
  gaps: GapSample[];
  onJumpToEvent: (eventIndex: number) => void;
};

/** Selected histogram bin index within the current render; -1 = none. */
let activeHistBinIndex = -1;

export function createGapHistogramSvg(
  bins: HistogramBin[],
  histOptions?: HistOptions,
): SVGSVGElement {
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
  const barRects: SVGRectElement[] = [];
  const countLabels: Array<SVGTextElement | null> = [];

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

  const syncBarActiveState = (): void => {
    for (let i = 0; i < barRects.length; i += 1) {
      const selected = activeHistBinIndex === i;
      const dimmed = activeHistBinIndex >= 0 && !selected;
      barRects[i].classList.toggle("is-active", selected);
      barRects[i].classList.toggle("is-dimmed", dimmed);
      const countEl = countLabels[i];
      if (countEl) countEl.classList.toggle("is-visible", selected);
    }
  };

  for (let i = 0; i < bins.length; i += 1) {
    const bin = bins[i];
    const h = (bin.count / maxCount) * plotH;
    const x = padL + i * (barW + gap);
    const y = padT + plotH - h;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", `bar${isHotGapBin(bin) ? " is-hot" : ""}`);
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(barW));
    rect.setAttribute("height", String(Math.max(bin.count > 0 ? 2 : 0, h)));
    rect.setAttribute("rx", "2");
    rect.style.cursor = bin.count > 0 ? "pointer" : "default";
    barRects.push(rect);
    svg.appendChild(rect);

    let countText: SVGTextElement | null = null;
    if (bin.count > 0) {
      countText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      countText.setAttribute("class", "count-label");
      countText.setAttribute("x", String(x + barW / 2));
      countText.setAttribute("y", String(Math.max(14, y - 4)));
      countText.setAttribute("text-anchor", "middle");
      countText.textContent = String(bin.count);
      svg.appendChild(countText);
    }
    countLabels.push(countText);

    // Show every other x label by default to reduce clutter; always show first/last.
    const showBinLabel = i === 0 || i === bins.length - 1 || i % 2 === 0;
    if (showBinLabel) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("class", "axis-label bin-label");
      label.setAttribute("x", String(x + barW / 2));
      label.setAttribute("y", String(padT + plotH + 14));
      label.setAttribute("text-anchor", "middle");
      label.textContent = formatGapBinLabel(bin);
      svg.appendChild(label);
    }

    const tipLines = [
      t("timelineGapBinTitle", [formatGapBinLabel(bin), String(bin.count)]),
      bin.count > 0 ? t("timelineGapBinTipAction") : t("timelineGapBinTipEmpty"),
    ];
    bindTimelineTooltip(rect, tipLines);

    rect.addEventListener("pointerenter", () => {
      if (countText) countText.classList.add("is-visible");
    });
    rect.addEventListener("pointerleave", () => {
      if (countText && activeHistBinIndex !== i) countText.classList.remove("is-visible");
    });

    if (histOptions && bin.count > 0) {
      rect.addEventListener("click", () => {
        if (activeHistBinIndex === i) {
          activeHistBinIndex = -1;
          syncBarActiveState();
          return;
        }
        activeHistBinIndex = i;
        syncBarActiveState();
        const inBin = gapsInBin(histOptions.gaps, bin);
        const top = largestGaps(inBin, 1)[0];
        if (top) histOptions.onJumpToEvent(top.afterIndex);
      });
    }
  }

  const xTitle = document.createElementNS("http://www.w3.org/2000/svg", "text");
  xTitle.setAttribute("class", "axis-title");
  xTitle.setAttribute("x", String(padL + plotW / 2));
  xTitle.setAttribute("y", "164");
  xTitle.setAttribute("text-anchor", "middle");
  xTitle.textContent = t("timelineGapHistogramX");
  svg.appendChild(xTitle);

  syncBarActiveState();
  return svg;
}

export function renderTimeline(
  record: StreamRecord | undefined,
  options: RenderTimelineOptions,
): void {
  if (!record) {
    hideTimelineTooltip();
    activeHistBinIndex = -1;
    elTimelinePlaceholder.hidden = false;
    elTimelinePlaceholder.textContent = t("noStreamSelected");
    elTimelineBody.hidden = true;
    elTimelineBody.innerHTML = "";
    return;
  }

  if (record.events.length === 0) {
    hideTimelineTooltip();
    activeHistBinIndex = -1;
    elTimelinePlaceholder.hidden = false;
    elTimelinePlaceholder.textContent = t("noEventsYet");
    elTimelineBody.hidden = true;
    elTimelineBody.innerHTML = "";
    return;
  }

  elTimelinePlaceholder.hidden = true;
  elTimelineBody.hidden = false;
  elTimelineBody.innerHTML = "";
  hideTimelineTooltip();
  activeHistBinIndex = -1;

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
  const durationMs = metrics.durationMs ?? spanMs;
  const maxGapMs = gaps.length > 0 ? Math.max(...gaps.map((g) => g.gapMs)) : undefined;
  const maxGapSlow = isStallGapMs(maxGapMs);

  elTimelineBody.appendChild(
    buildKpiRow({
      eventCount: record.events.length,
      eventsPerSec: metrics.eventsPerSec,
      durationMs,
      ttftMs: metrics.ttftMs,
      maxGapMs,
      maxGapSlow,
      reconnectCount: reconnects.length,
      lastReconnectOffsetMs:
        reconnects.length > 0
          ? Math.max(0, reconnects[reconnects.length - 1].at - origin)
          : undefined,
    }),
  );

  const trackSection = document.createElement("section");
  trackSection.className = "timeline-section";
  const trackHead = document.createElement("div");
  trackHead.className = "timeline-track-head";
  const trackTitleBlock = document.createElement("div");
  const trackTitle = document.createElement("div");
  trackTitle.className = "timeline-section-title";
  trackTitle.textContent = t("timelineTrackTitle");
  const trackHint = document.createElement("div");
  trackHint.className = "timeline-section-hint";
  trackHint.textContent = t("timelineTrackHint", String(TIMELINE_STALL_MS));
  trackTitleBlock.append(trackTitle, trackHint);
  trackHead.append(trackTitleBlock, buildLegend());
  trackSection.appendChild(trackHead);

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

  // Paint stalls after normal ticks so dense streams do not cover red marks.
  const paintMarks = [...marks].sort((a, b) => {
    const aStall = isStallGapMs(a.gapFromPrevMs) ? 1 : 0;
    const bStall = isStallGapMs(b.gapFromPrevMs) ? 1 : 0;
    return aStall - bStall || a.index - b.index;
  });

  for (const mark of paintMarks) {
    const x = padL + (mark.offsetMs / spanMs) * plotW;
    const isStall = isStallGapMs(mark.gapFromPrevMs);
    const isSelected = options.selectedEventIndex === mark.index;
    if (isSelected) {
      const halo = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      halo.setAttribute("class", "tick-select-halo");
      halo.setAttribute("x", String(x - 5));
      halo.setAttribute("y", String(trackY - 18));
      halo.setAttribute("width", "10");
      halo.setAttribute("height", "36");
      halo.setAttribute("rx", "2");
      svg.appendChild(halo);
    }
    const tickClass = `tick${isSelected ? " is-selected" : ""}${isStall ? " is-stall" : ""}`;
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    tick.setAttribute("class", tickClass);
    tick.setAttribute("x", String(x - 2));
    tick.setAttribute("y", String(trackY - 14));
    tick.setAttribute("width", "4");
    tick.setAttribute("height", "28");
    tick.setAttribute("rx", "1");
    tick.setAttribute("data-index", String(mark.index));
    bindTimelineTooltip(tick, tipLinesForMark(mark));
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
      bindTimelineTooltip(marker, [
        t("timelineReconnectMark", [
          String(reconnect.reconnectCount),
          reconnect.lastEventId ? reconnect.lastEventId : "—",
          `+${Math.round(offsetMs)}ms`,
        ]),
      ]);
      svg.appendChild(marker);
    }
  }

  const histSection = document.createElement("section");
  histSection.className = "timeline-section";
  const histTitle = document.createElement("div");
  histTitle.className = "timeline-section-title";
  histTitle.textContent = t("timelineGapHistogram");
  const histHint = document.createElement("div");
  histHint.className = "timeline-section-hint";
  histHint.textContent = t("timelineGapHistogramHint", String(TIMELINE_HOT_GAP_MS));
  histSection.append(histTitle, histHint);
  if (gaps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline-meta";
    empty.textContent = t("timelineGapHistogramEmpty");
    histSection.appendChild(empty);
  } else {
    histSection.appendChild(
      createGapHistogramSvg(buildGapHistogram(gaps), {
        gaps,
        onJumpToEvent: options.onJumpToEvent,
      }),
    );
  }
  elTimelineBody.appendChild(histSection);

  const insights = buildTimelineInsights({
    gaps,
    events: record.events,
    reconnects,
    originMs: origin,
  });
  elTimelineBody.appendChild(buildInsightsSection(insights, options));
}

function buildInsightsSection(
  insights: TimelineInsight[],
  options: RenderTimelineOptions,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "timeline-section timeline-insights";
  const title = document.createElement("div");
  title.className = "timeline-section-title";
  title.textContent = t("timelineInsights");
  const hint = document.createElement("div");
  hint.className = "timeline-section-hint";
  hint.textContent = t("timelineInsightsHint");
  section.append(title, hint);

  if (insights.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline-meta";
    empty.textContent = t("timelineInsightsEmpty");
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("div");
  list.className = "timeline-insight-list";
  for (const insight of insights) {
    list.appendChild(buildInsightButton(insight, options));
  }
  section.appendChild(list);
  return section;
}

function buildInsightButton(
  insight: TimelineInsight,
  options: RenderTimelineOptions,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  const isReconnect = insight.kind === "reconnect";
  const jumpIndex = insight.jumpIndex;
  const canJump = typeof jumpIndex === "number";
  btn.className = `timeline-insight${isReconnect ? " is-reconnect" : " is-stall"}${
    canJump && options.selectedEventIndex === jumpIndex ? " is-selected" : ""
  }`;
  btn.disabled = !canJump;

  const title =
    insight.kind === "stall"
      ? t("timelineInsightGapTitle", String(insight.afterIndex))
      : t("timelineInsightReconnect", String(insight.reconnectCount));
  const desc =
    insight.kind === "stall"
      ? t("timelineInsightGapDesc", insight.eventName ? insight.eventName : "—")
      : t("timelineInsightReconnectDesc", insight.lastEventId ? insight.lastEventId : "—");
  const metric =
    insight.kind === "stall"
      ? formatMetricMs(insight.gapMs)
      : `+${formatMetricMs(insight.offsetMs)}`;

  btn.innerHTML = `
    <i class="timeline-insight-dot" aria-hidden="true"></i>
    <span class="timeline-insight-copy">
      <span class="timeline-insight-title">${escapeHtml(title)}</span>
      <span class="timeline-insight-desc">${escapeHtml(desc)}</span>
    </span>
    <span class="timeline-insight-ms">${escapeHtml(metric)}</span>
  `;
  if (canJump) {
    btn.addEventListener("click", () => {
      options.onJumpToEvent(jumpIndex);
    });
  }
  return btn;
}

type KpiRowInput = {
  eventCount: number;
  eventsPerSec: number | undefined;
  durationMs: number;
  ttftMs: number | undefined;
  maxGapMs: number | undefined;
  maxGapSlow: boolean;
  reconnectCount: number;
  lastReconnectOffsetMs: number | undefined;
};

function buildKpiRow(input: KpiRowInput): HTMLElement {
  const row = document.createElement("div");
  row.className = "timeline-kpi-row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", t("timelineKpiAria"));

  row.append(
    kpiCard(t("timelineKpiEvents"), String(input.eventCount), {
      sub:
        typeof input.eventsPerSec === "number"
          ? t("timelineKpiEventsSub", String(input.eventsPerSec))
          : t("timelineKpiDash"),
    }),
    kpiCard(t("timelineKpiDuration"), formatMetricMs(input.durationMs), {
      sub:
        typeof input.ttftMs === "number"
          ? t("timelineKpiDurationSub", formatMetricMs(input.ttftMs))
          : t("timelineKpiDash"),
    }),
    kpiCard(
      t("timelineKpiMaxGap"),
      typeof input.maxGapMs === "number" ? formatMetricMs(input.maxGapMs) : t("timelineKpiDash"),
      {
        alert: input.maxGapSlow,
        sub: input.maxGapSlow
          ? t("timelineKpiMaxGapSlow", String(TIMELINE_STALL_MS))
          : t("timelineKpiMaxGapOk", String(TIMELINE_STALL_MS)),
      },
    ),
    kpiCard(t("timelineKpiReconnects"), String(input.reconnectCount), {
      sub:
        typeof input.lastReconnectOffsetMs === "number"
          ? t("timelineKpiReconnectsSub", `+${formatMetricMs(input.lastReconnectOffsetMs)}`)
          : t("timelineKpiDash"),
    }),
  );
  return row;
}

function kpiCard(
  label: string,
  value: string,
  options: { sub: string; alert?: boolean },
): HTMLElement {
  const card = document.createElement("div");
  card.className = `timeline-kpi${options.alert ? " is-alert" : ""}`;
  const labelEl = document.createElement("div");
  labelEl.className = "timeline-kpi-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("div");
  valueEl.className = "timeline-kpi-value";
  valueEl.textContent = value;
  const subEl = document.createElement("div");
  subEl.className = "timeline-kpi-sub";
  subEl.textContent = options.sub;
  card.append(labelEl, valueEl, subEl);
  return card;
}

function buildLegend(): HTMLElement {
  const legend = document.createElement("div");
  legend.className = "timeline-legend";
  legend.setAttribute("role", "list");
  legend.setAttribute("aria-label", t("timelineLegendAria"));

  const items: Array<{ swatch: string; label: string }> = [
    { swatch: "is-normal", label: t("timelineLegendNormal") },
    { swatch: "is-stall", label: t("timelineLegendStall", String(TIMELINE_STALL_MS)) },
    { swatch: "is-reconnect", label: t("timelineLegendReconnect") },
    { swatch: "is-selected", label: t("timelineLegendSelected") },
  ];
  for (const item of items) {
    const row = document.createElement("span");
    row.className = "timeline-legend-item";
    row.setAttribute("role", "listitem");
    const swatch = document.createElement("i");
    swatch.className = `timeline-legend-swatch ${item.swatch}`;
    swatch.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = item.label;
    row.append(swatch, text);
    legend.appendChild(row);
  }
  return legend;
}

function tipLinesForMark(mark: TimelineMark): string[] {
  const lines = [
    t("timelineTickTipMain", [String(mark.index), mark.event, formatMetricMs(mark.offsetMs)]),
  ];
  if (mark.gapFromPrevMs != null) {
    lines.push(t("timelineTickTipGap", formatMetricMs(mark.gapFromPrevMs)));
    if (isStallGapMs(mark.gapFromPrevMs)) lines.push(t("timelineTickTipStall"));
  } else {
    lines.push(t("timelineTickTipFirst"));
  }
  lines.push(t("timelineTickTipAction"));
  return lines;
}

let timelineTipEl: HTMLDivElement | null = null;

function ensureTimelineTooltip(): HTMLDivElement {
  if (!timelineTipEl || !timelineTipEl.isConnected) {
    timelineTipEl = document.createElement("div");
    timelineTipEl.className = "timeline-tooltip";
    timelineTipEl.setAttribute("role", "tooltip");
    timelineTipEl.hidden = true;
    document.body.appendChild(timelineTipEl);
  }
  return timelineTipEl;
}

function hideTimelineTooltip(): void {
  if (!timelineTipEl) return;
  timelineTipEl.hidden = true;
  timelineTipEl.classList.remove("is-on");
}

function showTimelineTooltip(clientX: number, clientY: number, lines: string[]): void {
  const tip = ensureTimelineTooltip();
  tip.replaceChildren();
  for (let i = 0; i < lines.length; i += 1) {
    const row = document.createElement("div");
    row.className = i === 0 ? "timeline-tooltip-main" : "timeline-tooltip-sub";
    if (lines[i] === t("timelineTickTipStall")) row.classList.add("is-stall");
    row.textContent = lines[i];
    tip.appendChild(row);
  }
  tip.hidden = false;
  tip.classList.add("is-on");
  const pad = 12;
  const tw = tip.offsetWidth || 180;
  const th = tip.offsetHeight || 48;
  let left = clientX + pad;
  let top = clientY + pad;
  if (left + tw > window.innerWidth - 8) left = Math.max(8, clientX - tw - pad);
  if (top + th > window.innerHeight - 8) top = Math.max(8, clientY - th - pad);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function bindTimelineTooltip(target: Element, lines: string[]): void {
  target.addEventListener("pointerenter", (e) => {
    const pe = e as PointerEvent;
    showTimelineTooltip(pe.clientX, pe.clientY, lines);
  });
  target.addEventListener("pointermove", (e) => {
    const pe = e as PointerEvent;
    showTimelineTooltip(pe.clientX, pe.clientY, lines);
  });
  target.addEventListener("pointerleave", () => {
    hideTimelineTooltip();
  });
}
