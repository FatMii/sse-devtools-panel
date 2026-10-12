import { t } from "../../shared/i18n";
import {
  aggregateArrivalLod,
  buildArrivalWaitSeries,
  buildGapHistogram,
  buildTimelineAnomalies,
  buildTimelineInsights,
  buildTimelineMarks,
  buildTimelinePhases,
  clampTimelineView,
  collectEventGaps,
  fitTimelineView,
  gapsInBin,
  hitTestArrivalMark,
  isHotGapBin,
  isStallGapMs,
  largestGaps,
  panTimelineView,
  TIMELINE_HOT_GAP_MS,
  TIMELINE_STALL_MS,
  TIMELINE_WATERFALL_LIMIT,
  timelineSpanMs,
  waterfallBarKind,
  zoomTimelineView,
  type GapSample,
  type HistogramBin,
  type TimelineAnomaly,
  type TimelineInsight,
  type TimelineMark,
  type TimelinePhaseKind,
  type TimelinePhaseSegment,
  type TimelineViewWindow,
} from "../../shared/stream-timing";
import type { SseEvent, StreamReconnectMark, StreamRecord } from "../../shared/types";
import { elTimelineBody, elTimelinePlaceholder } from "../core/dom";
import { formatGapBinLabel, formatMetricMs } from "../core/format";
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

type ArrivalTrackHandle = {
  wrap: HTMLElement;
  axis: HTMLElement;
  toolbar: HTMLElement;
  legend: HTMLElement;
  minimap: HTMLElement;
  update: (next: ArrivalTrackInput) => void;
  paint: () => void;
  disconnect: () => void;
};

type TimelineShell = {
  requestId: string;
  kpiRow: HTMLElement;
  track: ArrivalTrackHandle;
  histHost: HTMLElement;
  waterfallHost: HTMLElement;
};

let timelineShell: TimelineShell | null = null;
let timelineRaf = 0;
let timelinePending: { record: StreamRecord; options: RenderTimelineOptions } | null = null;

export function resetTimelineView(): void {
  cancelTimelineRender();
  teardownTimelineShell();
  hideTimelineTooltip();
  activeHistBinIndex = -1;
  elTimelinePlaceholder.hidden = false;
  elTimelinePlaceholder.textContent = t("noStreamSelected");
  elTimelineBody.hidden = true;
  elTimelineBody.replaceChildren();
}

function cancelTimelineRender(): void {
  if (timelineRaf) {
    cancelAnimationFrame(timelineRaf);
    timelineRaf = 0;
  }
  timelinePending = null;
}

function teardownTimelineShell(): void {
  timelineShell?.track.disconnect();
  timelineShell = null;
}

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
    cancelTimelineRender();
    teardownTimelineShell();
    hideTimelineTooltip();
    activeHistBinIndex = -1;
    elTimelinePlaceholder.hidden = false;
    elTimelinePlaceholder.textContent = t("noStreamSelected");
    elTimelineBody.hidden = true;
    elTimelineBody.replaceChildren();
    return;
  }

  if (record.events.length === 0) {
    cancelTimelineRender();
    teardownTimelineShell();
    hideTimelineTooltip();
    activeHistBinIndex = -1;
    elTimelinePlaceholder.hidden = false;
    elTimelinePlaceholder.textContent = t("noEventsYet");
    elTimelineBody.hidden = true;
    elTimelineBody.replaceChildren();
    return;
  }

  timelinePending = { record, options };
  if (timelineRaf) return;
  timelineRaf = requestAnimationFrame(() => {
    timelineRaf = 0;
    const job = timelinePending;
    timelinePending = null;
    if (job) applyTimelineRender(job.record, job.options);
  });
}

function applyTimelineRender(record: StreamRecord, options: RenderTimelineOptions): void {
  elTimelinePlaceholder.hidden = true;
  elTimelineBody.hidden = false;

  const origin = record.startedAt;
  const marks = buildTimelineMarks(record.events, origin);
  const reconnects = record.reconnects ?? [];
  const reconnectMaxOffset = reconnects.reduce((max, item) => {
    const offset = item.at - origin;
    return Number.isFinite(offset) && offset > max ? offset : max;
  }, 0);
  const gaps = collectEventGaps(record.events);
  const metrics = ensureStreamMetrics(record);
  const ended = typeof record.endedAt === "number" && Number.isFinite(record.endedAt);
  const spanMs = Math.max(
    timelineSpanMs(marks),
    reconnectMaxOffset,
    typeof metrics.durationMs === "number" ? metrics.durationMs : 0,
    1,
  );
  const durationMs = metrics.durationMs ?? spanMs;
  const maxGapMs = gaps.length > 0 ? Math.max(...gaps.map((g) => g.gapMs)) : undefined;
  const maxGapSlow = isStallGapMs(maxGapMs);
  const phases = buildTimelinePhases({ marks, spanMs, ended });
  const kpiInput: KpiRowInput = {
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
  };
  const trackInput: ArrivalTrackInput = {
    marks,
    reconnects,
    phases,
    events: record.events,
    spanMs,
    originMs: origin,
    selectedEventIndex: options.selectedEventIndex,
    onJumpToEvent: options.onJumpToEvent,
  };
  const insights = buildTimelineInsights({
    gaps,
    events: record.events,
    reconnects,
    originMs: origin,
    stallLimit: TIMELINE_WATERFALL_LIMIT,
  });

  const sameStream = timelineShell?.requestId === record.requestId;
  if (!sameStream || !timelineShell || !elTimelineBody.contains(timelineShell.kpiRow)) {
    hideTimelineTooltip();
    activeHistBinIndex = -1;
    rebuildTimelineShell(record.requestId, kpiInput, trackInput, gaps, insights, options);
    return;
  }

  updateKpiRow(timelineShell.kpiRow, kpiInput);
  timelineShell.track.update(trackInput);
  timelineShell.track.paint();
  fillHistHost(timelineShell.histHost, gaps, options);
  fillWaterfallHost(timelineShell.waterfallHost, insights, options);
}

function rebuildTimelineShell(
  requestId: string,
  kpiInput: KpiRowInput,
  trackInput: ArrivalTrackInput,
  gaps: GapSample[],
  insights: TimelineInsight[],
  options: RenderTimelineOptions,
): void {
  teardownTimelineShell();
  elTimelineBody.replaceChildren();

  const kpiRow = buildKpiRow(kpiInput);

  const trackSection = document.createElement("section");
  trackSection.className = "timeline-section";
  const trackHead = document.createElement("div");
  trackHead.className = "timeline-track-head";
  const trackTitleBlock = document.createElement("div");
  trackTitleBlock.className = "timeline-track-title-row";
  const trackTitle = document.createElement("div");
  trackTitle.className = "timeline-section-title";
  trackTitle.textContent = t("timelineTrackTitle");
  const trackTipsBtn = document.createElement("button");
  trackTipsBtn.type = "button";
  trackTipsBtn.className = "timeline-track-tips";
  trackTipsBtn.textContent = "?";
  trackTipsBtn.setAttribute("aria-label", t("timelineTrackTipsAria"));
  bindTimelineTooltip(trackTipsBtn, [
    t("timelineTrackNavHint"),
    t("timelineTrackHintTop", String(TIMELINE_STALL_MS)),
    t("timelineTrackHintBottom"),
    t("timelineTrackHintAction"),
  ]);
  trackTitleBlock.append(trackTitle, trackTipsBtn);
  const track = buildArrivalTrackCanvas(trackInput);
  trackHead.append(trackTitleBlock, track.legend, track.toolbar);
  trackSection.append(trackHead, track.wrap, track.axis, track.minimap);

  const histSection = document.createElement("section");
  histSection.className = "timeline-section";
  const histTitleRow = document.createElement("div");
  histTitleRow.className = "timeline-track-title-row";
  const histTitle = document.createElement("div");
  histTitle.className = "timeline-section-title";
  histTitle.textContent = t("timelineGapHistogram");
  const histTipsBtn = document.createElement("button");
  histTipsBtn.type = "button";
  histTipsBtn.className = "timeline-track-tips";
  histTipsBtn.textContent = "?";
  histTipsBtn.setAttribute("aria-label", t("timelineGapHistogramTipsAria"));
  bindTimelineTooltip(histTipsBtn, [
    t("timelineGapHistogramHintAxes"),
    t("timelineGapHistogramHintHot", String(TIMELINE_HOT_GAP_MS)),
    t("timelineGapHistogramHintAction"),
  ]);
  histTitleRow.append(histTitle, histTipsBtn);
  const histHost = document.createElement("div");
  histHost.className = "timeline-hist-host";
  histSection.append(histTitleRow, histHost);

  const waterfallSection = document.createElement("section");
  waterfallSection.className = "timeline-section";
  const waterfallTitleRow = document.createElement("div");
  waterfallTitleRow.className = "timeline-track-title-row";
  const waterfallTitle = document.createElement("div");
  waterfallTitle.className = "timeline-section-title";
  waterfallTitle.textContent = t("timelineWaitRank", String(TIMELINE_WATERFALL_LIMIT));
  const waterfallTipsBtn = document.createElement("button");
  waterfallTipsBtn.type = "button";
  waterfallTipsBtn.className = "timeline-track-tips";
  waterfallTipsBtn.textContent = "?";
  waterfallTipsBtn.setAttribute("aria-label", t("timelineWaitRankTipsAria"));
  bindTimelineTooltip(waterfallTipsBtn, [
    t("timelineWaitRankHintSort"),
    t("timelineWaitRankHintAction"),
  ]);
  waterfallTitleRow.append(waterfallTitle, waterfallTipsBtn);
  const waterfallHost = document.createElement("div");
  waterfallHost.className = "timeline-waterfall-host";
  waterfallSection.append(waterfallTitleRow, waterfallHost);

  elTimelineBody.append(kpiRow, trackSection, histSection, waterfallSection);
  timelineShell = { requestId, kpiRow, track, histHost, waterfallHost };

  fillHistHost(histHost, gaps, options);
  fillWaterfallHost(waterfallHost, insights, options);
  track.paint();
}

function fillHistHost(host: HTMLElement, gaps: GapSample[], options: RenderTimelineOptions): void {
  host.replaceChildren();
  if (gaps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline-meta";
    empty.textContent = t("timelineGapHistogramEmpty");
    host.appendChild(empty);
    return;
  }
  host.appendChild(
    createGapHistogramSvg(buildGapHistogram(gaps), {
      gaps,
      onJumpToEvent: options.onJumpToEvent,
    }),
  );
}

function fillWaterfallHost(
  host: HTMLElement,
  insights: TimelineInsight[],
  options: RenderTimelineOptions,
): void {
  host.replaceChildren();
  if (insights.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline-meta";
    empty.textContent = t("timelineWaitRankEmpty");
    host.appendChild(empty);
    return;
  }

  const stallGaps = insights.filter((item) => item.kind === "stall").map((item) => item.gapMs);
  const maxGap = Math.max(1, ...stallGaps);

  const list = document.createElement("div");
  list.className = "timeline-waterfall";
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", t("timelineWaitRank", String(TIMELINE_WATERFALL_LIMIT)));

  for (const insight of insights) {
    list.appendChild(buildWaterfallRow(insight, maxGap, options));
  }
  host.appendChild(list);
}

function buildWaterfallRow(
  insight: TimelineInsight,
  maxGap: number,
  options: RenderTimelineOptions,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "timeline-waterfall-row";
  btn.setAttribute("role", "listitem");

  const jumpIndex = insight.jumpIndex;
  const canJump = typeof jumpIndex === "number";
  btn.disabled = !canJump;
  if (canJump && options.selectedEventIndex === jumpIndex) {
    btn.classList.add("is-selected");
  }

  const label = document.createElement("span");
  label.className = "timeline-waterfall-label";
  const track = document.createElement("span");
  track.className = "timeline-waterfall-track";
  const bar = document.createElement("i");
  bar.setAttribute("aria-hidden", "true");
  track.appendChild(bar);
  const ms = document.createElement("span");
  ms.className = "timeline-waterfall-ms";

  if (insight.kind === "stall") {
    const tone = waterfallBarKind(insight.gapMs);
    const eventBit = insight.eventName ? ` - ${insight.eventName}` : "";
    label.textContent = `#${insight.afterIndex}${eventBit}`;
    bar.className = `timeline-waterfall-bar is-${tone}`;
    bar.style.width = `${Math.max(2, (insight.gapMs / maxGap) * 100)}%`;
    ms.classList.add(`is-${tone}`);
    ms.textContent = formatMetricMs(insight.gapMs);
  } else {
    btn.classList.add("is-reconnect");
    label.textContent = t("timelineWaitRankReconnect", String(insight.reconnectCount));
    bar.className = "timeline-waterfall-bar is-reconnect";
    bar.style.width = "28%";
    ms.classList.add("is-reconnect");
    ms.textContent = `+${formatMetricMs(insight.offsetMs)}`;
  }

  btn.append(label, track, ms);
  btn.title = canJump ? t("timelineTickTipAction") : "";
  if (canJump) {
    btn.addEventListener("click", () => {
      options.onJumpToEvent(jumpIndex);
    });
  }
  return btn;
}

/** Density lane taller for readable ticks; wait lane below. */
const ARRIVAL_DENSITY_USABLE_H = 180;
const ARRIVAL_WAIT_LANE_H = 120;
const ARRIVAL_TRACK_CSS_H = ARRIVAL_DENSITY_USABLE_H + 20 + ARRIVAL_WAIT_LANE_H;
const ARRIVAL_MINIMAP_CSS_H = 18;
/** Wide enough for peak labels like "9948 ms" right-aligned in the gutter. */
const ARRIVAL_PAD_L = 56;
const ARRIVAL_PAD_R = 12;

type ArrivalTrackInput = {
  marks: TimelineMark[];
  reconnects: StreamReconnectMark[];
  phases: TimelinePhaseSegment[];
  events: Array<Pick<SseEvent, "index" | "receivedAt" | "id">>;
  spanMs: number;
  originMs: number;
  selectedEventIndex: number | null;
  onJumpToEvent: (eventIndex: number) => void;
};

function buildArrivalTrackCanvas(initial: ArrivalTrackInput): ArrivalTrackHandle {
  let input = initial;
  let marksByIndex = new Map(initial.marks.map((m) => [m.index, m]));
  let view: TimelineViewWindow = fitTimelineView(initial.spanMs);
  let wasFit = true;
  let trackDragging = false;
  let trackDragMoved = false;
  let trackPointerId: number | null = null;
  let trackDragOriginX = 0;
  let trackDragOriginView = view;
  let miniDragging = false;
  let miniDragMoved = false;
  let miniPointerId: number | null = null;
  let miniGrabOffsetRatio = 0;
  let paintRaf = 0;
  let needsRemeasure = false;

  const wrap = document.createElement("div");
  wrap.className = "timeline-track-canvas-wrap";
  const canvas = document.createElement("canvas");
  canvas.className = "timeline-track-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", t("timelineTrackTitle"));
  const anomalyLayer = document.createElement("div");
  anomalyLayer.className = "timeline-anomaly-layer";
  anomalyLayer.setAttribute("aria-hidden", "false");
  wrap.append(canvas, anomalyLayer);

  const axis = document.createElement("div");
  axis.className = "timeline-track-axis";
  const axisStart = document.createElement("span");
  const axisMid = document.createElement("span");
  const axisEnd = document.createElement("span");
  axis.append(axisStart, axisMid, axisEnd);

  const legend = buildLegend();

  const toolbar = document.createElement("div");
  toolbar.className = "timeline-track-toolbar";

  const btnZoomOut = document.createElement("button");
  btnZoomOut.type = "button";
  btnZoomOut.textContent = "\u2212";
  btnZoomOut.title = t("timelineZoomOut");
  btnZoomOut.setAttribute("aria-label", t("timelineZoomOut"));
  const btnZoomIn = document.createElement("button");
  btnZoomIn.type = "button";
  btnZoomIn.textContent = "+";
  btnZoomIn.title = t("timelineZoomIn");
  btnZoomIn.setAttribute("aria-label", t("timelineZoomIn"));
  const btnFit = document.createElement("button");
  btnFit.type = "button";
  btnFit.textContent = t("timelineZoomFit");
  btnFit.title = t("timelineZoomFit");
  toolbar.append(btnZoomOut, btnZoomIn, btnFit);

  const minimap = document.createElement("div");
  minimap.className = "timeline-minimap";
  const miniCanvas = document.createElement("canvas");
  miniCanvas.className = "timeline-minimap-canvas";
  miniCanvas.setAttribute("aria-hidden", "true");
  const miniWindow = document.createElement("div");
  miniWindow.className = "timeline-minimap-window";
  minimap.append(miniCanvas, miniWindow);

  let plotLayout = {
    padL: ARRIVAL_PAD_L,
    plotW: 1,
    cssW: 1,
  };

  const syncChrome = (): void => {
    syncMinimapWindow(miniWindow, view, input.spanMs);
    axisStart.textContent = formatMetricMs(view.startMs);
    axisMid.textContent = formatMetricMs((view.startMs + view.endMs) / 2);
    axisEnd.textContent = formatMetricMs(view.endMs);
  };

  const syncAnomalyChips = (): void => {
    const anomalies = buildTimelineAnomalies({
      marks: input.marks,
      reconnects: input.reconnects,
      originMs: input.originMs,
      events: input.events,
    });
    syncAnomalyChipLayer(anomalyLayer, anomalies, {
      view,
      padL: plotLayout.padL,
      plotW: plotLayout.plotW,
      selectedEventIndex: input.selectedEventIndex,
      onJumpToEvent: input.onJumpToEvent,
    });
  };

  const paintFrame = (): void => {
    if (needsRemeasure) {
      plotLayout = measureArrivalPlot(canvas, ARRIVAL_PAD_L);
      needsRemeasure = false;
    }
    drawArrivalTrack(canvas, input, plotLayout, view);
    drawArrivalMinimap(miniCanvas, input);
    syncChrome();
    syncAnomalyChips();
  };

  const schedulePaint = (remeasure = false): void => {
    if (remeasure) needsRemeasure = true;
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(() => {
      paintRaf = 0;
      paintFrame();
    });
  };

  const paint = (): void => {
    needsRemeasure = true;
    if (paintRaf) {
      cancelAnimationFrame(paintRaf);
      paintRaf = 0;
    }
    paintFrame();
  };

  const setView = (next: TimelineViewWindow, fit = false): void => {
    view = clampTimelineView(next, input.spanMs);
    wasFit = fit;
    // Window chrome updates immediately; canvas redraw coalesces to next frame.
    syncChrome();
    schedulePaint();
  };

  btnZoomIn.addEventListener("click", () => {
    setView(zoomTimelineView(view, input.spanMs, 1 / 2, 0.5), false);
  });
  btnZoomOut.addEventListener("click", () => {
    setView(zoomTimelineView(view, input.spanMs, 2, 0.5), false);
  });
  btnFit.addEventListener("click", () => {
    setView(fitTimelineView(input.spanMs), true);
  });

  const resolvePlotX = (clientX: number): number | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return clientX - rect.left - plotLayout.padL;
  };

  wrap.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const plotX = resolvePlotX(e.clientX);
      const ratio =
        plotX == null || plotLayout.plotW <= 0
          ? 0.5
          : Math.min(1, Math.max(0, plotX / plotLayout.plotW));
      const factor = e.deltaY > 0 ? 1.35 : 1 / 1.35;
      setView(zoomTimelineView(view, input.spanMs, factor, ratio), false);
    },
    { passive: false },
  );

  wrap.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    trackDragging = true;
    trackDragMoved = false;
    trackPointerId = e.pointerId;
    trackDragOriginX = e.clientX;
    trackDragOriginView = view;
    wrap.classList.add("is-panning");
    wrap.setPointerCapture(e.pointerId);
  });

  const endTrackDrag = (pointerId: number): void => {
    if (trackPointerId !== pointerId) return;
    trackDragging = false;
    trackPointerId = null;
    wrap.classList.remove("is-panning");
  };

  wrap.addEventListener("pointerup", (e) => {
    endTrackDrag(e.pointerId);
  });
  wrap.addEventListener("pointercancel", (e) => {
    endTrackDrag(e.pointerId);
  });

  wrap.addEventListener("pointermove", (e) => {
    if (trackDragging) {
      const dx = e.clientX - trackDragOriginX;
      if (Math.abs(dx) > 2) trackDragMoved = true;
      const span = Math.max(1, trackDragOriginView.endMs - trackDragOriginView.startMs);
      const dMs = (-dx / Math.max(1, plotLayout.plotW)) * span;
      setView(panTimelineView(trackDragOriginView, input.spanMs, dMs), false);
      hideTimelineTooltip();
      return;
    }

    const plotX = resolvePlotX(e.clientX);
    if (plotX == null) {
      hideTimelineTooltip();
      return;
    }
    const waitSeries = buildArrivalWaitSeries(
      input.marks,
      view.startMs,
      view.endMs,
      Math.max(24, Math.floor(plotLayout.plotW / 2)),
    );
    const waitBi = Math.min(
      waitSeries.bucketCount - 1,
      Math.max(0, Math.floor((plotX / Math.max(1, plotLayout.plotW)) * waitSeries.bucketCount)),
    );
    const waitAtHoverMs = waitSeries.waitsMs[waitBi] ?? 0;
    const index = hitTestArrivalMark(
      input.marks,
      plotX,
      plotLayout.plotW,
      view.startMs,
      view.endMs,
      16,
    );
    const mark = index == null ? null : (marksByIndex.get(index) ?? null);
    const rect = canvas.getBoundingClientRect();
    const localY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * ARRIVAL_TRACK_CSS_H;
    const tipFocus = resolveTipFocus(localY);
    if (tipFocus === "density" && !mark) {
      hideTimelineTooltip();
      return;
    }
    showTimelineTooltip(
      e.clientX,
      e.clientY,
      tipLinesForHover(mark, {
        focus: tipFocus,
        waitAtHoverMs,
      }),
    );
  });

  wrap.addEventListener("pointerleave", () => {
    if (!trackDragging) hideTimelineTooltip();
  });

  wrap.addEventListener("click", (e) => {
    if (trackDragMoved) return;
    const plotX = resolvePlotX(e.clientX);
    if (plotX == null) return;
    const index = hitTestArrivalMark(
      input.marks,
      plotX,
      plotLayout.plotW,
      view.startMs,
      view.endMs,
    );
    if (index != null) input.onJumpToEvent(index);
  });

  const eClientXToRatio = (clientX: number, rect: DOMRect): number =>
    Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));

  minimap.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = minimap.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = eClientXToRatio(e.clientX, rect);
    const span = Math.max(1, input.spanMs);
    const startRatio = view.startMs / span;
    const endRatio = view.endMs / span;
    const windowRatio = Math.max(0.002, endRatio - startRatio);
    if (ratio >= startRatio && ratio <= endRatio) {
      miniGrabOffsetRatio = ratio - startRatio;
    } else {
      miniGrabOffsetRatio = windowRatio / 2;
      setView(
        clampTimelineView(
          {
            startMs: ratio * span - (windowRatio * span) / 2,
            endMs: ratio * span + (windowRatio * span) / 2,
          },
          span,
        ),
        false,
      );
    }
    miniDragging = true;
    miniDragMoved = false;
    miniPointerId = e.pointerId;
    minimap.classList.add("is-panning");
    minimap.setPointerCapture(e.pointerId);
  });

  const endMiniDrag = (pointerId: number): void => {
    if (miniPointerId !== pointerId) return;
    miniDragging = false;
    miniPointerId = null;
    minimap.classList.remove("is-panning");
  };

  minimap.addEventListener("pointermove", (e) => {
    if (!miniDragging) return;
    miniDragMoved = true;
    const rect = minimap.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = eClientXToRatio(e.clientX, rect);
    const span = Math.max(1, input.spanMs);
    const windowMs = Math.max(1, view.endMs - view.startMs);
    const startMs = (ratio - miniGrabOffsetRatio) * span;
    setView(clampTimelineView({ startMs, endMs: startMs + windowMs }, span), false);
  });

  minimap.addEventListener("pointerup", (e) => {
    endMiniDrag(e.pointerId);
  });
  minimap.addEventListener("pointercancel", (e) => {
    endMiniDrag(e.pointerId);
  });

  minimap.addEventListener("click", (e) => {
    if (miniDragMoved) return;
    const rect = minimap.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = eClientXToRatio(e.clientX, rect);
    const windowMs = Math.max(1, view.endMs - view.startMs);
    const center = ratio * input.spanMs;
    setView(
      clampTimelineView(
        { startMs: center - windowMs / 2, endMs: center + windowMs / 2 },
        input.spanMs,
      ),
      false,
    );
  });

  const ro = new ResizeObserver(() => {
    schedulePaint(true);
  });
  ro.observe(wrap);
  ro.observe(minimap);

  return {
    wrap,
    axis,
    toolbar,
    legend,
    minimap,
    update: (next) => {
      input = next;
      marksByIndex = new Map(next.marks.map((m) => [m.index, m]));
      if (wasFit) view = fitTimelineView(next.spanMs);
      else view = clampTimelineView(view, next.spanMs);
    },
    paint,
    disconnect: () => {
      if (paintRaf) cancelAnimationFrame(paintRaf);
      paintRaf = 0;
      ro.disconnect();
    },
  };
}

function resolveTipFocus(localY: number): "density" | "wait" {
  const lanes = arrivalLaneLayout(ARRIVAL_TRACK_CSS_H);
  if (lanes.splitY != null && localY >= lanes.splitY) return "wait";
  return "density";
}

function measureArrivalPlot(
  canvas: HTMLCanvasElement,
  padL: number,
): {
  padL: number;
  plotW: number;
  cssW: number;
} {
  const cssW = Math.max(1, canvas.getBoundingClientRect().width || canvas.clientWidth || 320);
  const plotW = Math.max(1, cssW - padL - ARRIVAL_PAD_R);
  return { padL, plotW, cssW };
}

function readCssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function mixCssColor(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(pct)}%, transparent)`;
}

type ArrivalLaneLayout = {
  density: { top: number; bottom: number; mid: number };
  wait: { top: number; bottom: number };
  markerTop: number;
  markerBottom: number;
  splitY: number;
};

/** Top = arrival density at old solo-track usable height; bottom = wait-ms. */
function arrivalLaneLayout(cssH: number): ArrivalLaneLayout {
  const dTop = 10;
  const dBottom = dTop + ARRIVAL_DENSITY_USABLE_H;
  const splitY = dBottom + 4;
  return {
    density: { top: dTop, bottom: dBottom, mid: (dTop + dBottom) / 2 },
    wait: { top: splitY + 6, bottom: cssH - 10 },
    markerTop: 6,
    markerBottom: cssH - 8,
    splitY,
  };
}

function drawArrivalTrack(
  canvas: HTMLCanvasElement,
  input: ArrivalTrackInput,
  layout: { padL: number; plotW: number; cssW: number },
  view: TimelineViewWindow,
): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = layout.cssW;
  const cssH = ARRIVAL_TRACK_CSS_H;
  const pixelW = Math.max(1, Math.floor(cssW * dpr));
  const pixelH = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = layout.padL;
  const plotW = layout.plotW;
  const lanes = arrivalLaneLayout(cssH);
  const viewStart = view.startMs;
  const viewEnd = Math.max(viewStart + 1, view.endMs);
  const viewSpan = viewEnd - viewStart;
  const accent = readCssColor("--accent", "#176fc1");
  const accentStrong = readCssColor("--accent-strong", "#145fa8");
  const danger = readCssColor("--danger", "#c33c30");
  const warning = readCssColor("--warning", "#9a6700");
  const good = readCssColor("--good", "#218739");
  const muted = readCssColor("--text-muted", "#596779");
  const stroke = readCssColor("--stroke", "#d8dee8");
  const strokeStrong = readCssColor("--stroke-strong", "#b8c3d1");
  const sans = readCssColor("--sans", "sans-serif");

  const toX = (offsetMs: number): number => padL + ((offsetMs - viewStart) / viewSpan) * plotW;

  const dens = lanes.density;
  const densH = Math.max(1, dens.bottom - dens.top);
  for (const phase of input.phases) {
    if (phase.endMs <= viewStart || phase.startMs >= viewEnd) continue;
    const left = Math.max(padL, toX(phase.startMs));
    const right = Math.min(padL + plotW, toX(phase.endMs));
    if (right <= left) continue;
    ctx.fillStyle = phaseBandFill(phase.kind, accent, good, danger, muted);
    ctx.fillRect(left, dens.top, right - left, densH);
  }

  ctx.strokeStyle = strokeStrong;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padL, dens.mid);
  ctx.lineTo(padL + plotW, dens.mid);
  ctx.stroke();

  const { buckets, maxCount } = aggregateArrivalLod(input.marks, plotW, viewStart, viewEnd);
  // Bars must scale with densH — a hard 26px cap made taller lanes look unchanged.
  const maxBar = densH * 0.72;
  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i];
    if (!bucket.count) continue;
    const alpha = 0.25 + 0.75 * (bucket.count / maxCount);
    ctx.fillStyle =
      bucket.stallCount > 0 ? mixCssColor(danger, alpha * 100) : mixCssColor(accent, alpha * 70);
    const bh = Math.max(12, maxBar * (bucket.count / maxCount));
    ctx.fillRect(padL + i, dens.mid - bh / 2, 1.5, bh);
  }

  ctx.fillStyle = muted;
  ctx.font = `10px ${sans}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(t("timelineLaneArrival"), padL + plotW, dens.top);

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, lanes.splitY);
  ctx.lineTo(padL + plotW, lanes.splitY);
  ctx.stroke();

  const waitLane = lanes.wait;
  const waitSeries = buildArrivalWaitSeries(
    input.marks,
    viewStart,
    viewEnd,
    Math.max(24, Math.floor(plotW / 2)),
  );
  const waitH = Math.max(1, waitLane.bottom - waitLane.top);
  const peakLabel = formatMetricMs(waitSeries.maxWaitMs);

  ctx.strokeStyle = mixCssColor(strokeStrong, 55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, waitLane.bottom);
  ctx.lineTo(padL + plotW, waitLane.bottom);
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = warning;
  ctx.lineWidth = 1.75;
  for (let i = 0; i < waitSeries.bucketCount; i += 1) {
    const x = padL + ((i + 0.5) / waitSeries.bucketCount) * plotW;
    const y =
      waitLane.bottom - (waitSeries.waitsMs[i] / Math.max(1, waitSeries.maxWaitMs)) * waitH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Y scale fully inside left gutter (padL=56); title on the right.
  ctx.fillStyle = muted;
  ctx.font = `10px ${sans}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(peakLabel, padL - 8, waitLane.top + 1);
  ctx.textBaseline = "bottom";
  ctx.fillText("0", padL - 8, waitLane.bottom);
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillStyle = warning;
  ctx.fillText(t("timelineLaneWait"), padL + plotW, waitLane.top + 1);

  if (input.selectedEventIndex != null) {
    const selected = input.marks.find((m) => m.index === input.selectedEventIndex);
    if (selected && selected.offsetMs >= viewStart && selected.offsetMs <= viewEnd) {
      const sx = toX(selected.offsetMs);
      ctx.strokeStyle = accentStrong;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx, lanes.markerTop);
      ctx.lineTo(sx, lanes.markerBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      const tickMid = dens.mid;
      const tickH = Math.min(48, densH * 0.7);
      if (isStallGapMs(selected.gapFromPrevMs)) {
        ctx.strokeStyle = accentStrong;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx - 5, tickMid - tickH / 2, 10, tickH);
        ctx.fillStyle = danger;
      } else {
        ctx.fillStyle = accentStrong;
      }
      ctx.fillRect(sx - 2, tickMid - tickH / 2, 4, tickH);
    }
  }

  for (const reconnect of input.reconnects) {
    const offsetMs = Math.max(0, reconnect.at - input.originMs);
    if (offsetMs < viewStart || offsetMs > viewEnd) continue;
    const x = toX(offsetMs);
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, lanes.markerTop);
    ctx.lineTo(x, lanes.markerBottom);
    ctx.stroke();
    ctx.setLineDash([]);
    const cy = lanes.markerTop + 14;
    ctx.strokeStyle = muted;
    ctx.fillStyle = "transparent";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(x, cy - 5);
    ctx.lineTo(x + 5, cy);
    ctx.lineTo(x, cy + 5);
    ctx.lineTo(x - 5, cy);
    ctx.closePath();
    ctx.stroke();
  }
}

function phaseBandFill(
  kind: TimelinePhaseKind,
  accent: string,
  good: string,
  danger: string,
  muted: string,
): string {
  switch (kind) {
    case "ttft":
      return mixCssColor(accent, 22);
    case "steady":
      return mixCssColor(good, 14);
    case "stall":
      return mixCssColor(danger, 20);
    case "done":
      return mixCssColor(muted, 18);
  }
}

function syncMinimapWindow(windowEl: HTMLElement, view: TimelineViewWindow, spanMs: number): void {
  const span = Math.max(1, spanMs);
  const leftPct = (view.startMs / span) * 100;
  const widthPct = (Math.max(1, view.endMs - view.startMs) / span) * 100;
  windowEl.style.left = `${leftPct}%`;
  windowEl.style.width = `${Math.min(100, Math.max(1.5, widthPct))}%`;
}

function drawArrivalMinimap(canvas: HTMLCanvasElement, input: ArrivalTrackInput): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(1, canvas.getBoundingClientRect().width || canvas.clientWidth || 320);
  const cssH = ARRIVAL_MINIMAP_CSS_H;
  const pixelW = Math.max(1, Math.floor(cssW * dpr));
  const pixelH = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const spanMs = Math.max(1, input.spanMs);
  const accent = readCssColor("--accent", "#176fc1");
  const warning = readCssColor("--warning", "#9a6700");
  const { buckets, maxCount } = aggregateArrivalLod(input.marks, cssW, 0, spanMs);
  for (let i = 0; i < buckets.length; i += 1) {
    if (!buckets[i].count) continue;
    ctx.fillStyle = mixCssColor(accent, 30 + (70 * buckets[i].count) / maxCount);
    ctx.fillRect(i, 3, 1, 12);
  }
  for (const reconnect of input.reconnects) {
    const offsetMs = Math.max(0, reconnect.at - input.originMs);
    const x = (Math.min(offsetMs, spanMs) / spanMs) * cssW;
    ctx.fillStyle = warning;
    ctx.fillRect(x - 1, 1, 2, 16);
  }
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
    kpiCard("events", t("timelineKpiEvents"), String(input.eventCount), {
      sub:
        typeof input.eventsPerSec === "number"
          ? t("timelineKpiEventsSub", String(input.eventsPerSec))
          : t("timelineKpiDash"),
    }),
    kpiCard("duration", t("timelineKpiDuration"), formatMetricMs(input.durationMs), {
      sub:
        typeof input.ttftMs === "number"
          ? t("timelineKpiDurationSub", formatMetricMs(input.ttftMs))
          : t("timelineKpiDash"),
    }),
    kpiCard(
      "maxGap",
      t("timelineKpiMaxGap"),
      typeof input.maxGapMs === "number" ? formatMetricMs(input.maxGapMs) : t("timelineKpiDash"),
      {
        alert: input.maxGapSlow,
        sub: input.maxGapSlow
          ? t("timelineKpiMaxGapSlow", String(TIMELINE_STALL_MS))
          : t("timelineKpiMaxGapOk", String(TIMELINE_STALL_MS)),
      },
    ),
    kpiCard("reconnects", t("timelineKpiReconnects"), String(input.reconnectCount), {
      sub:
        typeof input.lastReconnectOffsetMs === "number"
          ? t("timelineKpiReconnectsSub", `+${formatMetricMs(input.lastReconnectOffsetMs)}`)
          : t("timelineKpiDash"),
    }),
  );
  return row;
}

function updateKpiRow(row: HTMLElement, input: KpiRowInput): void {
  setKpiCard(row, "events", String(input.eventCount), {
    sub:
      typeof input.eventsPerSec === "number"
        ? t("timelineKpiEventsSub", String(input.eventsPerSec))
        : t("timelineKpiDash"),
  });
  setKpiCard(row, "duration", formatMetricMs(input.durationMs), {
    sub:
      typeof input.ttftMs === "number"
        ? t("timelineKpiDurationSub", formatMetricMs(input.ttftMs))
        : t("timelineKpiDash"),
  });
  setKpiCard(
    row,
    "maxGap",
    typeof input.maxGapMs === "number" ? formatMetricMs(input.maxGapMs) : t("timelineKpiDash"),
    {
      alert: input.maxGapSlow,
      sub: input.maxGapSlow
        ? t("timelineKpiMaxGapSlow", String(TIMELINE_STALL_MS))
        : t("timelineKpiMaxGapOk", String(TIMELINE_STALL_MS)),
    },
  );
  setKpiCard(row, "reconnects", String(input.reconnectCount), {
    sub:
      typeof input.lastReconnectOffsetMs === "number"
        ? t("timelineKpiReconnectsSub", `+${formatMetricMs(input.lastReconnectOffsetMs)}`)
        : t("timelineKpiDash"),
  });
}

function setKpiCard(
  row: HTMLElement,
  key: string,
  value: string,
  options: { sub: string; alert?: boolean },
): void {
  const card = row.querySelector<HTMLElement>(`[data-kpi="${key}"]`);
  if (!card) return;
  card.classList.toggle("is-alert", Boolean(options.alert));
  const valueEl = card.querySelector(".timeline-kpi-value");
  const subEl = card.querySelector(".timeline-kpi-sub");
  if (valueEl) valueEl.textContent = value;
  if (subEl) subEl.textContent = options.sub;
}

function kpiCard(
  key: string,
  label: string,
  value: string,
  options: { sub: string; alert?: boolean },
): HTMLElement {
  const card = document.createElement("div");
  card.className = `timeline-kpi${options.alert ? " is-alert" : ""}`;
  card.dataset.kpi = key;
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

function syncAnomalyChipLayer(
  layer: HTMLElement,
  anomalies: TimelineAnomaly[],
  options: {
    view: TimelineViewWindow;
    padL: number;
    plotW: number;
    selectedEventIndex: number | null;
    onJumpToEvent: (eventIndex: number) => void;
  },
): void {
  layer.replaceChildren();
  const viewSpan = Math.max(1, options.view.endMs - options.view.startMs);
  for (const anomaly of anomalies) {
    if (anomaly.offsetMs < options.view.startMs || anomaly.offsetMs > options.view.endMs) {
      continue;
    }
    const x =
      options.padL + ((anomaly.offsetMs - options.view.startMs) / viewSpan) * options.plotW;
    if (x < options.padL - 4 || x > options.padL + options.plotW + 4) continue;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `timeline-anomaly-chip is-${anomaly.kind}`;
    btn.textContent = anomalyChipLabel(anomaly);
    btn.style.left = `${x}px`;
    const jumpIndex = anomaly.jumpIndex;
    const canJump = typeof jumpIndex === "number";
    btn.disabled = !canJump;
    if (canJump && options.selectedEventIndex === jumpIndex) {
      btn.classList.add("is-selected");
    }
    btn.title = canJump ? t("timelineTickTipAction") : "";
    btn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    if (canJump) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        options.onJumpToEvent(jumpIndex);
      });
    }
    layer.appendChild(btn);
  }
}

function anomalyChipLabel(anomaly: TimelineAnomaly): string {
  switch (anomaly.kind) {
    case "stall":
      return t("timelineAnomalyStall", formatMetricMs(anomaly.gapMs));
    case "reconnect":
      return t("timelineAnomalyReconnect", String(anomaly.reconnectCount));
  }
}

function buildLegend(): HTMLElement {
  const legend = document.createElement("div");
  legend.className = "timeline-legend";
  legend.setAttribute("role", "list");
  legend.setAttribute("aria-label", t("timelineLegendAria"));

  const items: Array<{ swatch: string; label: string }> = [
    { swatch: "is-normal", label: t("timelineLegendNormal") },
    { swatch: "is-stall", label: t("timelineLegendStall", String(TIMELINE_STALL_MS)) },
    { swatch: "is-wait", label: t("timelineLegendWait") },
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

type TipLine = { text: string; kind: "main" | "wait" | "gap" | "stall" | "action" | "meta" };

function tipLinesForHover(
  mark: TimelineMark | null,
  options: { focus: "density" | "wait"; waitAtHoverMs: number },
): TipLine[] {
  if (options.focus === "wait") {
    const lines: TipLine[] = [
      {
        text: t("timelineTickTipWaitMain", formatMetricMs(options.waitAtHoverMs)),
        kind: "wait",
      },
    ];
    if (mark) {
      lines.push({
        text: t("timelineTickTipNearestEvent", [String(mark.index), mark.event]),
        kind: "meta",
      });
      lines.push({ text: t("timelineTickTipAction"), kind: "action" });
    }
    return lines;
  }

  if (!mark) return [];
  const lines: TipLine[] = [];
  if (mark.gapFromPrevMs != null) {
    lines.push({
      text: t("timelineTickTipMain", [
        String(mark.index),
        mark.event,
        formatMetricMs(mark.gapFromPrevMs),
      ]),
      kind: "gap",
    });
    if (isStallGapMs(mark.gapFromPrevMs)) {
      lines.push({ text: t("timelineTickTipStall"), kind: "stall" });
    }
  } else {
    lines.push({
      text: t("timelineTickTipMainFirst", [String(mark.index), mark.event]),
      kind: "main",
    });
  }
  lines.push({ text: t("timelineTickTipAction"), kind: "action" });
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

function showTimelineTooltip(clientX: number, clientY: number, lines: TipLine[]): void {
  const tip = ensureTimelineTooltip();
  tip.replaceChildren();
  for (let i = 0; i < lines.length; i += 1) {
    const row = document.createElement("div");
    const line = lines[i];
    row.className =
      i === 0 || line.kind === "wait" || line.kind === "gap"
        ? "timeline-tooltip-main"
        : "timeline-tooltip-sub";
    if (line.kind === "stall") row.classList.add("is-stall");
    if (line.kind === "wait") row.classList.add("is-wait");
    if (line.kind === "gap") row.classList.add("is-gap");
    row.textContent = line.text;
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
  const tipLines: TipLine[] = lines.map((text, i) => ({
    text,
    kind: i === 0 ? "main" : "meta",
  }));
  target.addEventListener("pointerenter", (e) => {
    const pe = e as PointerEvent;
    showTimelineTooltip(pe.clientX, pe.clientY, tipLines);
  });
  target.addEventListener("pointermove", (e) => {
    const pe = e as PointerEvent;
    showTimelineTooltip(pe.clientX, pe.clientY, tipLines);
  });
  target.addEventListener("pointerleave", () => {
    hideTimelineTooltip();
  });
}
