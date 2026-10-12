import { t } from "../../shared/i18n";
import {
  aggregateArrivalLod,
  buildArrivalWaitSeries,
  buildGapHistogram,
  buildTimingAnomalies,
  buildTimingInsights,
  buildTimingMarks,
  buildTimingPhases,
  clampTimingView,
  collectEventGaps,
  collectTimingLaneTypes,
  fitTimingView,
  gapsInBin,
  hitTestArrivalMark,
  hitTestTimingLaneMark,
  isHotGapBin,
  isStallGapMs,
  largestGaps,
  normalizeTimingEventType,
  panTimingView,
  TIMING_HOT_GAP_MS,
  TIMING_STALL_MS,
  TIMING_WATERFALL_LIMIT,
  timingSpanMs,
  waterfallBarKind,
  zoomTimingView,
  type GapSample,
  type HistogramBin,
  type TimingAnomaly,
  type TimingInsight,
  type TimingMark,
  type TimingPhaseKind,
  type TimingPhaseSegment,
  type TimingViewWindow,
} from "../../shared/stream-timing";
import type { SseEvent, StreamReconnectMark, StreamRecord } from "../../shared/types";
import { elTimingBody, elTimingPlaceholder } from "../core/dom";
import { formatGapBinLabel, formatMetricMs } from "../core/format";
import { ensureStreamMetrics } from "../features/stream-metrics";

/** Re-export for callers; single source of truth is stream-timing. */
export { TIMING_STALL_MS, TIMING_HOT_GAP_MS };

export type RenderTimingOptions = {
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
  getView: () => TimingViewWindow;
  onViewChange: (cb: (view: TimingViewWindow) => void) => () => void;
  update: (next: ArrivalTrackInput) => void;
  paint: () => void;
  disconnect: () => void;
};

type LanesHandle = {
  root: HTMLElement;
  update: (input: LanesInput) => void;
  setView: (view: TimingViewWindow) => void;
  disconnect: () => void;
};

type TimingShell = {
  requestId: string;
  kpiRow: HTMLElement;
  track: ArrivalTrackHandle;
  histHost: HTMLElement;
  waterfallHost: HTMLElement;
  lanes: LanesHandle;
  unsubView: () => void;
};

let timingShell: TimingShell | null = null;
let timingRaf = 0;
let timingPending: { record: StreamRecord; options: RenderTimingOptions } | null = null;
/** Enabled lane types; reset on stream change. */
let laneFilterOn = new Set<string>();
/** Types already offered to the filter UI (so new types default on). */
let laneTypesSeen = new Set<string>();

export function resetTimingView(): void {
  cancelTimingRender();
  teardownTimingShell();
  hideTimingTooltip();
  activeHistBinIndex = -1;
  resetLaneFilterState();
  elTimingPlaceholder.hidden = false;
  elTimingPlaceholder.textContent = t("noStreamSelected");
  elTimingBody.hidden = true;
  elTimingBody.replaceChildren();
}

function resetLaneFilterState(): void {
  laneFilterOn = new Set();
  laneTypesSeen = new Set();
}

function syncLaneFilterTypes(types: string[]): void {
  for (const type of types) {
    if (!laneTypesSeen.has(type)) {
      laneFilterOn.add(type);
      laneTypesSeen.add(type);
    }
  }
}

function cancelTimingRender(): void {
  if (timingRaf) {
    cancelAnimationFrame(timingRaf);
    timingRaf = 0;
  }
  timingPending = null;
}

function teardownTimingShell(): void {
  timingShell?.unsubView();
  timingShell?.lanes.disconnect();
  timingShell?.track.disconnect();
  timingShell = null;
}

export function createGapHistogramSvg(
  bins: HistogramBin[],
  histOptions?: HistOptions,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "gap-histogram");
  svg.setAttribute("viewBox", "0 0 440 170");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("timingGapHistogram"));

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
  yTitle.textContent = t("timingGapHistogramY");
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
      t("timingGapBinTitle", [formatGapBinLabel(bin), String(bin.count)]),
      bin.count > 0 ? t("timingGapBinTipAction") : t("timingGapBinTipEmpty"),
    ];
    bindTimingTooltip(rect, tipLines);

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
  xTitle.textContent = t("timingGapHistogramX");
  svg.appendChild(xTitle);

  syncBarActiveState();
  return svg;
}

export function renderTiming(record: StreamRecord | undefined, options: RenderTimingOptions): void {
  if (!record) {
    cancelTimingRender();
    teardownTimingShell();
    hideTimingTooltip();
    activeHistBinIndex = -1;
    elTimingPlaceholder.hidden = false;
    elTimingPlaceholder.textContent = t("noStreamSelected");
    elTimingBody.hidden = true;
    elTimingBody.replaceChildren();
    return;
  }

  if (record.events.length === 0) {
    cancelTimingRender();
    teardownTimingShell();
    hideTimingTooltip();
    activeHistBinIndex = -1;
    elTimingPlaceholder.hidden = false;
    elTimingPlaceholder.textContent = t("noEventsYet");
    elTimingBody.hidden = true;
    elTimingBody.replaceChildren();
    return;
  }

  timingPending = { record, options };
  if (timingRaf) return;
  timingRaf = requestAnimationFrame(() => {
    timingRaf = 0;
    const job = timingPending;
    timingPending = null;
    if (job) applyTimingRender(job.record, job.options);
  });
}

function applyTimingRender(record: StreamRecord, options: RenderTimingOptions): void {
  elTimingPlaceholder.hidden = true;
  elTimingBody.hidden = false;

  const origin = record.startedAt;
  const marks = buildTimingMarks(record.events, origin);
  const reconnects = record.reconnects ?? [];
  const reconnectMaxOffset = reconnects.reduce((max, item) => {
    const offset = item.at - origin;
    return Number.isFinite(offset) && offset > max ? offset : max;
  }, 0);
  const gaps = collectEventGaps(record.events);
  const metrics = ensureStreamMetrics(record);
  const ended = typeof record.endedAt === "number" && Number.isFinite(record.endedAt);
  const spanMs = Math.max(
    timingSpanMs(marks),
    reconnectMaxOffset,
    typeof metrics.durationMs === "number" ? metrics.durationMs : 0,
    1,
  );
  const durationMs = metrics.durationMs ?? spanMs;
  const maxGapMs = gaps.length > 0 ? Math.max(...gaps.map((g) => g.gapMs)) : undefined;
  const maxGapSlow = isStallGapMs(maxGapMs);
  const phases = buildTimingPhases({ marks, spanMs, ended });
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
  const insights = buildTimingInsights({
    gaps,
    events: record.events,
    reconnects,
    originMs: origin,
    stallLimit: TIMING_WATERFALL_LIMIT,
  });

  const sameStream = timingShell?.requestId === record.requestId;
  if (!sameStream || !timingShell || !elTimingBody.contains(timingShell.kpiRow)) {
    hideTimingTooltip();
    activeHistBinIndex = -1;
    resetLaneFilterState();
    rebuildTimingShell(record.requestId, kpiInput, trackInput, gaps, insights, options);
    return;
  }

  updateKpiRow(timingShell.kpiRow, kpiInput);
  timingShell.track.update(trackInput);
  timingShell.track.paint();
  fillHistHost(timingShell.histHost, gaps, options);
  fillWaterfallHost(timingShell.waterfallHost, insights, options);
  timingShell.lanes.update({
    marks,
    selectedEventIndex: options.selectedEventIndex,
    onJumpToEvent: options.onJumpToEvent,
  });
  timingShell.lanes.setView(timingShell.track.getView());
}

function rebuildTimingShell(
  requestId: string,
  kpiInput: KpiRowInput,
  trackInput: ArrivalTrackInput,
  gaps: GapSample[],
  insights: TimingInsight[],
  options: RenderTimingOptions,
): void {
  teardownTimingShell();
  elTimingBody.replaceChildren();

  const kpiRow = buildKpiRow(kpiInput);

  const trackSection = document.createElement("section");
  trackSection.className = "timing-section";
  const trackHead = document.createElement("div");
  trackHead.className = "timing-track-head";
  const trackTitleBlock = document.createElement("div");
  trackTitleBlock.className = "timing-track-title-row";
  const trackTitle = document.createElement("div");
  trackTitle.className = "timing-section-title";
  trackTitle.textContent = t("timingTrackTitle");
  const trackTipsBtn = document.createElement("button");
  trackTipsBtn.type = "button";
  trackTipsBtn.className = "timing-track-tips";
  trackTipsBtn.textContent = "?";
  trackTipsBtn.setAttribute("aria-label", t("timingTrackTipsAria"));
  bindTimingTooltip(trackTipsBtn, [
    t("timingTrackNavHint"),
    t("timingTrackHintTop", String(TIMING_STALL_MS)),
    t("timingTrackHintBottom"),
    t("timingTrackHintAction"),
  ]);
  trackTitleBlock.append(trackTitle, trackTipsBtn);
  const track = buildArrivalTrackCanvas(trackInput);
  trackHead.append(trackTitleBlock, track.legend, track.toolbar);
  trackSection.append(trackHead, track.wrap, track.axis, track.minimap);

  const histSection = document.createElement("section");
  histSection.className = "timing-section";
  const histTitleRow = document.createElement("div");
  histTitleRow.className = "timing-track-title-row";
  const histTitle = document.createElement("div");
  histTitle.className = "timing-section-title";
  histTitle.textContent = t("timingGapHistogram");
  const histTipsBtn = document.createElement("button");
  histTipsBtn.type = "button";
  histTipsBtn.className = "timing-track-tips";
  histTipsBtn.textContent = "?";
  histTipsBtn.setAttribute("aria-label", t("timingGapHistogramTipsAria"));
  bindTimingTooltip(histTipsBtn, [
    t("timingGapHistogramHintAxes"),
    t("timingGapHistogramHintHot", String(TIMING_HOT_GAP_MS)),
    t("timingGapHistogramHintAction"),
  ]);
  histTitleRow.append(histTitle, histTipsBtn);
  const histHost = document.createElement("div");
  histHost.className = "timing-hist-host";
  histSection.append(histTitleRow, histHost);

  const waterfallSection = document.createElement("section");
  waterfallSection.className = "timing-section";
  const waterfallTitleRow = document.createElement("div");
  waterfallTitleRow.className = "timing-track-title-row";
  const waterfallTitle = document.createElement("div");
  waterfallTitle.className = "timing-section-title";
  waterfallTitle.textContent = t("timingWaitRank", String(TIMING_WATERFALL_LIMIT));
  const waterfallTipsBtn = document.createElement("button");
  waterfallTipsBtn.type = "button";
  waterfallTipsBtn.className = "timing-track-tips";
  waterfallTipsBtn.textContent = "?";
  waterfallTipsBtn.setAttribute("aria-label", t("timingWaitRankTipsAria"));
  bindTimingTooltip(waterfallTipsBtn, [t("timingWaitRankHintSort"), t("timingWaitRankHintAction")]);
  waterfallTitleRow.append(waterfallTitle, waterfallTipsBtn);
  const waterfallHost = document.createElement("div");
  waterfallHost.className = "timing-waterfall-host";
  waterfallSection.append(waterfallTitleRow, waterfallHost);

  const lanes = buildLanesSection({
    marks: trackInput.marks,
    selectedEventIndex: options.selectedEventIndex,
    onJumpToEvent: options.onJumpToEvent,
  });

  elTimingBody.append(kpiRow, trackSection, histSection, waterfallSection, lanes.root);
  const unsubView = track.onViewChange((view) => {
    lanes.setView(view);
  });
  timingShell = { requestId, kpiRow, track, histHost, waterfallHost, lanes, unsubView };

  fillHistHost(histHost, gaps, options);
  fillWaterfallHost(waterfallHost, insights, options);
  track.paint();
  lanes.setView(track.getView());
}

function fillHistHost(host: HTMLElement, gaps: GapSample[], options: RenderTimingOptions): void {
  host.replaceChildren();
  if (gaps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timing-meta";
    empty.textContent = t("timingGapHistogramEmpty");
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
  insights: TimingInsight[],
  options: RenderTimingOptions,
): void {
  host.replaceChildren();
  if (insights.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timing-meta";
    empty.textContent = t("timingWaitRankEmpty");
    host.appendChild(empty);
    return;
  }

  const stallGaps = insights.filter((item) => item.kind === "stall").map((item) => item.gapMs);
  const maxGap = Math.max(1, ...stallGaps);

  const list = document.createElement("div");
  list.className = "timing-waterfall";
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", t("timingWaitRank", String(TIMING_WATERFALL_LIMIT)));

  for (const insight of insights) {
    list.appendChild(buildWaterfallRow(insight, maxGap, options));
  }
  host.appendChild(list);
}

function buildWaterfallRow(
  insight: TimingInsight,
  maxGap: number,
  options: RenderTimingOptions,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "timing-waterfall-row";
  btn.setAttribute("role", "listitem");

  const jumpIndex = insight.jumpIndex;
  const canJump = typeof jumpIndex === "number";
  btn.disabled = !canJump;
  if (canJump && options.selectedEventIndex === jumpIndex) {
    btn.classList.add("is-selected");
  }

  const label = document.createElement("span");
  label.className = "timing-waterfall-label";
  const track = document.createElement("span");
  track.className = "timing-waterfall-track";
  const bar = document.createElement("i");
  bar.setAttribute("aria-hidden", "true");
  track.appendChild(bar);
  const ms = document.createElement("span");
  ms.className = "timing-waterfall-ms";

  if (insight.kind === "stall") {
    const tone = waterfallBarKind(insight.gapMs);
    const eventBit = insight.eventName ? ` - ${insight.eventName}` : "";
    label.textContent = `#${insight.afterIndex}${eventBit}`;
    bar.className = `timing-waterfall-bar is-${tone}`;
    bar.style.width = `${Math.max(2, (insight.gapMs / maxGap) * 100)}%`;
    ms.classList.add(`is-${tone}`);
    ms.textContent = formatMetricMs(insight.gapMs);
  } else {
    btn.classList.add("is-reconnect");
    label.textContent = t("timingWaitRankReconnect", String(insight.reconnectCount));
    bar.className = "timing-waterfall-bar is-reconnect";
    bar.style.width = "28%";
    ms.classList.add("is-reconnect");
    ms.textContent = `+${formatMetricMs(insight.offsetMs)}`;
  }

  btn.append(label, track, ms);
  btn.title = canJump ? t("timingTickTipAction") : "";
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
  marks: TimingMark[];
  reconnects: StreamReconnectMark[];
  phases: TimingPhaseSegment[];
  events: Array<Pick<SseEvent, "index" | "receivedAt" | "id">>;
  spanMs: number;
  originMs: number;
  selectedEventIndex: number | null;
  onJumpToEvent: (eventIndex: number) => void;
};

function buildArrivalTrackCanvas(initial: ArrivalTrackInput): ArrivalTrackHandle {
  let input = initial;
  let marksByIndex = new Map(initial.marks.map((m) => [m.index, m]));
  let view: TimingViewWindow = fitTimingView(initial.spanMs);
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
  const viewListeners = new Set<(next: TimingViewWindow) => void>();

  const wrap = document.createElement("div");
  wrap.className = "timing-track-canvas-wrap";
  const canvas = document.createElement("canvas");
  canvas.className = "timing-track-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", t("timingTrackTitle"));
  const anomalyLayer = document.createElement("div");
  anomalyLayer.className = "timing-anomaly-layer";
  anomalyLayer.setAttribute("aria-hidden", "false");
  wrap.append(canvas, anomalyLayer);

  const axis = document.createElement("div");
  axis.className = "timing-track-axis";
  const axisStart = document.createElement("span");
  const axisMid = document.createElement("span");
  const axisEnd = document.createElement("span");
  axis.append(axisStart, axisMid, axisEnd);

  const legend = buildLegend();

  const toolbar = document.createElement("div");
  toolbar.className = "timing-track-toolbar";

  const btnZoomOut = document.createElement("button");
  btnZoomOut.type = "button";
  btnZoomOut.textContent = "\u2212";
  btnZoomOut.title = t("timingZoomOut");
  btnZoomOut.setAttribute("aria-label", t("timingZoomOut"));
  const btnZoomIn = document.createElement("button");
  btnZoomIn.type = "button";
  btnZoomIn.textContent = "+";
  btnZoomIn.title = t("timingZoomIn");
  btnZoomIn.setAttribute("aria-label", t("timingZoomIn"));
  const btnFit = document.createElement("button");
  btnFit.type = "button";
  btnFit.textContent = t("timingZoomFit");
  btnFit.title = t("timingZoomFit");
  toolbar.append(btnZoomOut, btnZoomIn, btnFit);

  const minimap = document.createElement("div");
  minimap.className = "timing-minimap";
  const miniCanvas = document.createElement("canvas");
  miniCanvas.className = "timing-minimap-canvas";
  miniCanvas.setAttribute("aria-hidden", "true");
  const miniWindow = document.createElement("div");
  miniWindow.className = "timing-minimap-window";
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
    const anomalies = buildTimingAnomalies({
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

  const notifyView = (): void => {
    for (const cb of viewListeners) cb(view);
  };

  const setView = (next: TimingViewWindow, fit = false): void => {
    view = clampTimingView(next, input.spanMs);
    wasFit = fit;
    // Window chrome updates immediately; canvas redraw coalesces to next frame.
    syncChrome();
    notifyView();
    schedulePaint();
  };

  btnZoomIn.addEventListener("click", () => {
    setView(zoomTimingView(view, input.spanMs, 1 / 2, 0.5), false);
  });
  btnZoomOut.addEventListener("click", () => {
    setView(zoomTimingView(view, input.spanMs, 2, 0.5), false);
  });
  btnFit.addEventListener("click", () => {
    setView(fitTimingView(input.spanMs), true);
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
      setView(zoomTimingView(view, input.spanMs, factor, ratio), false);
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
      setView(panTimingView(trackDragOriginView, input.spanMs, dMs), false);
      hideTimingTooltip();
      return;
    }

    const plotX = resolvePlotX(e.clientX);
    if (plotX == null) {
      hideTimingTooltip();
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
      hideTimingTooltip();
      return;
    }
    showTimingTooltip(
      e.clientX,
      e.clientY,
      tipLinesForHover(mark, {
        focus: tipFocus,
        waitAtHoverMs,
      }),
    );
  });

  wrap.addEventListener("pointerleave", () => {
    if (!trackDragging) hideTimingTooltip();
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
        clampTimingView(
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
    setView(clampTimingView({ startMs, endMs: startMs + windowMs }, span), false);
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
      clampTimingView(
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
    getView: () => view,
    onViewChange: (cb) => {
      viewListeners.add(cb);
      return () => {
        viewListeners.delete(cb);
      };
    },
    update: (next) => {
      input = next;
      marksByIndex = new Map(next.marks.map((m) => [m.index, m]));
      if (wasFit) view = fitTimingView(next.spanMs);
      else view = clampTimingView(view, next.spanMs);
      notifyView();
    },
    paint,
    disconnect: () => {
      if (paintRaf) cancelAnimationFrame(paintRaf);
      paintRaf = 0;
      viewListeners.clear();
      ro.disconnect();
    },
  };
}

const LANES_PAD_L_MIN = 72;
const LANES_PAD_L_MAX = 148;
const LANES_PAD_R = ARRIVAL_PAD_R;
const LANES_ROW_H = 36;
const LANES_TOP = 16;
const LANES_LABEL_GAP = 10;

type LanesInput = {
  marks: TimingMark[];
  selectedEventIndex: number | null;
  onJumpToEvent: (eventIndex: number) => void;
};

function buildLanesSection(initial: LanesInput): LanesHandle {
  let input = initial;
  let view: TimingViewWindow = { startMs: 0, endMs: 1 };
  let types = collectTimingLaneTypes(initial.marks);
  syncLaneFilterTypes(types);

  const root = document.createElement("section");
  root.className = "timing-section";

  const titleRow = document.createElement("div");
  titleRow.className = "timing-track-title-row";
  const title = document.createElement("div");
  title.className = "timing-section-title";
  title.textContent = t("timingLanesTitle");
  const tipsBtn = document.createElement("button");
  tipsBtn.type = "button";
  tipsBtn.className = "timing-track-tips";
  tipsBtn.textContent = "?";
  tipsBtn.setAttribute("aria-label", t("timingLanesTipsAria"));
  bindTimingTooltip(tipsBtn, [
    t("timingLanesHintRows"),
    t("timingLanesHintFilter"),
    t("timingLanesHintAction"),
  ]);
  titleRow.append(title, tipsBtn);

  const filters = document.createElement("div");
  filters.className = "timing-lanes-filters";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", t("timingLanesTitle"));

  const wrap = document.createElement("div");
  wrap.className = "timing-lanes-canvas-wrap";
  const canvas = document.createElement("canvas");
  canvas.className = "timing-lanes-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", t("timingLanesTitle"));
  wrap.appendChild(canvas);

  const empty = document.createElement("div");
  empty.className = "timing-meta";
  empty.textContent = t("timingLanesEmpty");

  root.append(titleRow, filters, wrap, empty);

  let paintRaf = 0;
  let needsRemeasure = false;
  let plotLayout = { padL: LANES_PAD_L_MIN, plotW: 1, cssW: 1 };

  const syncChrome = (): void => {
    const hasEvents = input.marks.length > 0 && types.length > 0;
    wrap.hidden = !hasEvents;
    empty.hidden = hasEvents;
    filters.hidden = !hasEvents;
  };

  const rebuildFilters = (): void => {
    filters.replaceChildren();
    types.forEach((type, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "timing-lanes-chip";
      btn.dataset.lane = type;
      btn.dataset.laneColor = laneColorKey(i);
      btn.textContent = type;
      btn.title = type;
      btn.setAttribute("aria-label", t("timingLanesFilterAria", type));
      const on = laneFilterOn.has(type);
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.addEventListener("click", () => {
        if (laneFilterOn.has(type)) laneFilterOn.delete(type);
        else laneFilterOn.add(type);
        btn.classList.toggle("is-on", laneFilterOn.has(type));
        btn.setAttribute("aria-pressed", laneFilterOn.has(type) ? "true" : "false");
        schedulePaint();
      });
      filters.appendChild(btn);
    });
  };

  const paintFrame = (): void => {
    syncChrome();
    if (input.marks.length === 0 || types.length === 0) return;
    const cssW = Math.max(1, canvas.getBoundingClientRect().width || canvas.clientWidth || 320);
    const cssH = LANES_TOP + types.length * LANES_ROW_H + 8;
    const mono =
      getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "monospace";
    const font = `11px ${mono}`;
    const padL = measureLaneLabelPad(types, font, cssW);
    plotLayout = {
      padL,
      plotW: Math.max(1, cssW - padL - LANES_PAD_R),
      cssW,
    };
    needsRemeasure = false;
    drawTimingLanes(canvas, {
      marks: input.marks,
      types,
      enabled: laneFilterOn,
      view,
      selectedEventIndex: input.selectedEventIndex,
      padL: plotLayout.padL,
      padR: LANES_PAD_R,
      cssW,
      cssH,
      font,
    });
  };

  const schedulePaint = (remeasure = false): void => {
    if (remeasure) needsRemeasure = true;
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(() => {
      paintRaf = 0;
      paintFrame();
    });
  };

  wrap.addEventListener("pointermove", (e) => {
    const hit = resolveLaneHit(
      e,
      canvas,
      plotLayout.padL,
      plotLayout.plotW,
      types,
      view,
      input.marks,
    );
    if (!hit) {
      hideTimingTooltip();
      return;
    }
    const mark = input.marks.find((m) => m.index === hit.index) ?? null;
    showTimingTooltip(e.clientX, e.clientY, tipLinesForLane(mark, hit.type));
  });
  wrap.addEventListener("pointerleave", () => {
    hideTimingTooltip();
  });
  wrap.addEventListener("click", (e) => {
    const hit = resolveLaneHit(
      e,
      canvas,
      plotLayout.padL,
      plotLayout.plotW,
      types,
      view,
      input.marks,
    );
    if (hit) input.onJumpToEvent(hit.index);
  });

  const ro = new ResizeObserver(() => {
    schedulePaint(true);
  });
  ro.observe(wrap);

  rebuildFilters();
  syncChrome();

  return {
    root,
    update: (next) => {
      input = next;
      types = collectTimingLaneTypes(next.marks);
      syncLaneFilterTypes(types);
      rebuildFilters();
      schedulePaint(true);
    },
    setView: (next) => {
      view = next;
      schedulePaint();
    },
    disconnect: () => {
      if (paintRaf) cancelAnimationFrame(paintRaf);
      paintRaf = 0;
      ro.disconnect();
    },
  };
}

function laneColorKey(index: number): string {
  return String.fromCharCode(97 + (index % 4)); // a..d
}

function laneCssVar(index: number): string {
  return `--lane-${laneColorKey(index)}`;
}

function resolveLaneHit(
  e: PointerEvent | MouseEvent,
  canvas: HTMLCanvasElement,
  padL: number,
  plotW: number,
  types: string[],
  view: TimingViewWindow,
  marks: TimingMark[],
): { type: string; index: number } | null {
  if (types.length === 0 || plotW <= 0) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const cssH = LANES_TOP + types.length * LANES_ROW_H + 8;
  const localY = ((e.clientY - rect.top) / rect.height) * cssH;
  const laneIndex = Math.floor((localY - LANES_TOP + LANES_ROW_H / 2) / LANES_ROW_H);
  if (laneIndex < 0 || laneIndex >= types.length) return null;
  const type = types[laneIndex];
  if (!laneFilterOn.has(type)) return null;
  const plotX = e.clientX - rect.left - padL;
  if (plotX < -8 || plotX > plotW + 8) return null;
  const index = hitTestTimingLaneMark(marks, type, plotX, plotW, view.startMs, view.endMs, 16);
  if (index == null) return null;
  return { type, index };
}

function tipLinesForLane(mark: TimingMark | null, type: string): TipLine[] {
  if (!mark) return [{ text: type, kind: "meta" }];
  if (mark.gapFromPrevMs != null) {
    return [
      {
        text: t("timingTickTipMain", [
          String(mark.index),
          type,
          formatMetricMs(mark.gapFromPrevMs),
        ]),
        kind: "gap",
      },
      { text: `+${formatMetricMs(mark.offsetMs)}`, kind: "meta" },
      { text: t("timingTickTipAction"), kind: "action" },
    ];
  }
  return [
    {
      text: t("timingTickTipNearestEvent", [String(mark.index), type]),
      kind: "main",
    },
    { text: `+${formatMetricMs(mark.offsetMs)}`, kind: "meta" },
    { text: t("timingTickTipAction"), kind: "action" },
  ];
}

/** Left gutter wide enough for type names; keep a usable plot width. */
function measureLaneLabelPad(types: string[], font: string, cssW: number): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return LANES_PAD_L_MIN;
  ctx.font = font;
  let maxText = 0;
  for (const type of types) {
    maxText = Math.max(maxText, ctx.measureText(type).width);
  }
  const wanted = Math.ceil(maxText) + LANES_LABEL_GAP + 4;
  const maxByWidth = Math.max(LANES_PAD_L_MIN, Math.floor(cssW * 0.42));
  return Math.min(LANES_PAD_L_MAX, maxByWidth, Math.max(LANES_PAD_L_MIN, wanted));
}

/** Prefer keeping the prefix when the gutter still overflows. */
function fitLaneLabel(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "\u2026";
  if (ctx.measureText(ellipsis).width > maxWidth) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ellipsis : ellipsis;
}

function drawTimingLanes(
  canvas: HTMLCanvasElement,
  opts: {
    marks: TimingMark[];
    types: string[];
    enabled: Set<string>;
    view: TimingViewWindow;
    selectedEventIndex: number | null;
    padL: number;
    padR: number;
    cssW: number;
    cssH: number;
    font: string;
  },
): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const { cssW, cssH, padL, padR, view, types, marks, enabled, selectedEventIndex, font } = opts;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const plotW = Math.max(1, cssW - padL - padR);
  const viewSpan = Math.max(1, view.endMs - view.startMs);
  const muted = readCssColor("--text-muted", "#596779");
  const stroke = readCssColor("--stroke", "#d8dee8");
  const selected = readCssColor("--accent-strong", "#145fa8");
  const labelMaxW = Math.max(8, padL - LANES_LABEL_GAP);

  types.forEach((type, li) => {
    const y = LANES_TOP + li * LANES_ROW_H;
    ctx.font = font;
    ctx.fillStyle = muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = enabled.has(type) ? 1 : 0.4;
    const label = fitLaneLabel(ctx, type, labelMaxW);
    ctx.fillText(label, 4, y);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();

    if (!enabled.has(type)) return;

    const color = readCssColor(laneCssVar(li), readCssColor("--accent", "#176fc1"));
    ctx.fillStyle = color;
    for (const mark of marks) {
      if (normalizeTimingEventType(mark.event) !== type) continue;
      if (mark.offsetMs < view.startMs || mark.offsetMs > view.endMs) continue;
      const x = padL + ((mark.offsetMs - view.startMs) / viewSpan) * plotW;
      const isSelected = selectedEventIndex === mark.index;
      ctx.globalAlpha = isSelected ? 1 : 0.75;
      if (isSelected) {
        ctx.fillStyle = selected;
        ctx.fillRect(x - 1.5, y - 10, 3, 20);
        ctx.fillStyle = color;
      } else {
        ctx.fillRect(x - 1, y - 8, 2, 16);
      }
    }
    ctx.globalAlpha = 1;
  });
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
  view: TimingViewWindow,
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
  // Bars must scale with densH � a hard 26px cap made taller lanes look unchanged.
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
  ctx.fillText(t("timingLaneArrival"), padL + plotW, dens.top);

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
    const y = waitLane.bottom - (waitSeries.waitsMs[i] / Math.max(1, waitSeries.maxWaitMs)) * waitH;
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
  ctx.fillText(t("timingLaneWait"), padL + plotW, waitLane.top + 1);

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
  kind: TimingPhaseKind,
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

function syncMinimapWindow(windowEl: HTMLElement, view: TimingViewWindow, spanMs: number): void {
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
  row.className = "timing-kpi-row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", t("timingKpiAria"));
  row.append(
    kpiCard("events", t("timingKpiEvents"), String(input.eventCount), {
      sub:
        typeof input.eventsPerSec === "number"
          ? t("timingKpiEventsSub", String(input.eventsPerSec))
          : t("timingKpiDash"),
    }),
    kpiCard("duration", t("timingKpiDuration"), formatMetricMs(input.durationMs), {
      sub:
        typeof input.ttftMs === "number"
          ? t("timingKpiDurationSub", formatMetricMs(input.ttftMs))
          : t("timingKpiDash"),
    }),
    kpiCard(
      "maxGap",
      t("timingKpiMaxGap"),
      typeof input.maxGapMs === "number" ? formatMetricMs(input.maxGapMs) : t("timingKpiDash"),
      {
        alert: input.maxGapSlow,
        sub: input.maxGapSlow
          ? t("timingKpiMaxGapSlow", String(TIMING_STALL_MS))
          : t("timingKpiMaxGapOk", String(TIMING_STALL_MS)),
      },
    ),
    kpiCard("reconnects", t("timingKpiReconnects"), String(input.reconnectCount), {
      sub:
        typeof input.lastReconnectOffsetMs === "number"
          ? t("timingKpiReconnectsSub", `+${formatMetricMs(input.lastReconnectOffsetMs)}`)
          : t("timingKpiDash"),
    }),
  );
  return row;
}

function updateKpiRow(row: HTMLElement, input: KpiRowInput): void {
  setKpiCard(row, "events", String(input.eventCount), {
    sub:
      typeof input.eventsPerSec === "number"
        ? t("timingKpiEventsSub", String(input.eventsPerSec))
        : t("timingKpiDash"),
  });
  setKpiCard(row, "duration", formatMetricMs(input.durationMs), {
    sub:
      typeof input.ttftMs === "number"
        ? t("timingKpiDurationSub", formatMetricMs(input.ttftMs))
        : t("timingKpiDash"),
  });
  setKpiCard(
    row,
    "maxGap",
    typeof input.maxGapMs === "number" ? formatMetricMs(input.maxGapMs) : t("timingKpiDash"),
    {
      alert: input.maxGapSlow,
      sub: input.maxGapSlow
        ? t("timingKpiMaxGapSlow", String(TIMING_STALL_MS))
        : t("timingKpiMaxGapOk", String(TIMING_STALL_MS)),
    },
  );
  setKpiCard(row, "reconnects", String(input.reconnectCount), {
    sub:
      typeof input.lastReconnectOffsetMs === "number"
        ? t("timingKpiReconnectsSub", `+${formatMetricMs(input.lastReconnectOffsetMs)}`)
        : t("timingKpiDash"),
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
  const valueEl = card.querySelector(".timing-kpi-value");
  const subEl = card.querySelector(".timing-kpi-sub");
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
  card.className = `timing-kpi${options.alert ? " is-alert" : ""}`;
  card.dataset.kpi = key;
  const labelEl = document.createElement("div");
  labelEl.className = "timing-kpi-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("div");
  valueEl.className = "timing-kpi-value";
  valueEl.textContent = value;
  const subEl = document.createElement("div");
  subEl.className = "timing-kpi-sub";
  subEl.textContent = options.sub;
  card.append(labelEl, valueEl, subEl);
  return card;
}

function syncAnomalyChipLayer(
  layer: HTMLElement,
  anomalies: TimingAnomaly[],
  options: {
    view: TimingViewWindow;
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
    const x = options.padL + ((anomaly.offsetMs - options.view.startMs) / viewSpan) * options.plotW;
    if (x < options.padL - 4 || x > options.padL + options.plotW + 4) continue;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `timing-anomaly-chip is-${anomaly.kind}`;
    btn.textContent = anomalyChipLabel(anomaly);
    btn.style.left = `${x}px`;
    const jumpIndex = anomaly.jumpIndex;
    const canJump = typeof jumpIndex === "number";
    btn.disabled = !canJump;
    if (canJump && options.selectedEventIndex === jumpIndex) {
      btn.classList.add("is-selected");
    }
    btn.title = canJump ? t("timingTickTipAction") : "";
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

function anomalyChipLabel(anomaly: TimingAnomaly): string {
  switch (anomaly.kind) {
    case "stall":
      return t("timingAnomalyStall", formatMetricMs(anomaly.gapMs));
    case "reconnect":
      return t("timingAnomalyReconnect", String(anomaly.reconnectCount));
  }
}

function buildLegend(): HTMLElement {
  const legend = document.createElement("div");
  legend.className = "timing-legend";
  legend.setAttribute("role", "list");
  legend.setAttribute("aria-label", t("timingLegendAria"));

  const items: Array<{ swatch: string; label: string }> = [
    { swatch: "is-normal", label: t("timingLegendNormal") },
    { swatch: "is-stall", label: t("timingLegendStall", String(TIMING_STALL_MS)) },
    { swatch: "is-wait", label: t("timingLegendWait") },
    { swatch: "is-reconnect", label: t("timingLegendReconnect") },
    { swatch: "is-selected", label: t("timingLegendSelected") },
  ];
  for (const item of items) {
    const row = document.createElement("span");
    row.className = "timing-legend-item";
    row.setAttribute("role", "listitem");
    const swatch = document.createElement("i");
    swatch.className = `timing-legend-swatch ${item.swatch}`;
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
  mark: TimingMark | null,
  options: { focus: "density" | "wait"; waitAtHoverMs: number },
): TipLine[] {
  if (options.focus === "wait") {
    const lines: TipLine[] = [
      {
        text: t("timingTickTipWaitMain", formatMetricMs(options.waitAtHoverMs)),
        kind: "wait",
      },
    ];
    if (mark) {
      lines.push({
        text: t("timingTickTipNearestEvent", [String(mark.index), mark.event]),
        kind: "meta",
      });
      lines.push({ text: t("timingTickTipAction"), kind: "action" });
    }
    return lines;
  }

  if (!mark) return [];
  const lines: TipLine[] = [];
  if (mark.gapFromPrevMs != null) {
    lines.push({
      text: t("timingTickTipMain", [
        String(mark.index),
        mark.event,
        formatMetricMs(mark.gapFromPrevMs),
      ]),
      kind: "gap",
    });
    if (isStallGapMs(mark.gapFromPrevMs)) {
      lines.push({ text: t("timingTickTipStall"), kind: "stall" });
    }
  } else {
    lines.push({
      text: t("timingTickTipMainFirst", [String(mark.index), mark.event]),
      kind: "main",
    });
  }
  lines.push({ text: t("timingTickTipAction"), kind: "action" });
  return lines;
}

let timingTipEl: HTMLDivElement | null = null;

function ensureTimingTooltip(): HTMLDivElement {
  if (!timingTipEl || !timingTipEl.isConnected) {
    timingTipEl = document.createElement("div");
    timingTipEl.className = "timing-tooltip";
    timingTipEl.setAttribute("role", "tooltip");
    timingTipEl.hidden = true;
    document.body.appendChild(timingTipEl);
  }
  return timingTipEl;
}

function hideTimingTooltip(): void {
  if (!timingTipEl) return;
  timingTipEl.hidden = true;
  timingTipEl.classList.remove("is-on");
}

function showTimingTooltip(clientX: number, clientY: number, lines: TipLine[]): void {
  const tip = ensureTimingTooltip();
  tip.replaceChildren();
  for (let i = 0; i < lines.length; i += 1) {
    const row = document.createElement("div");
    const line = lines[i];
    row.className =
      i === 0 || line.kind === "wait" || line.kind === "gap"
        ? "timing-tooltip-main"
        : "timing-tooltip-sub";
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

function bindTimingTooltip(target: Element, lines: string[]): void {
  const tipLines: TipLine[] = lines.map((text, i) => ({
    text,
    kind: i === 0 ? "main" : "meta",
  }));
  target.addEventListener("pointerenter", (e) => {
    const pe = e as PointerEvent;
    showTimingTooltip(pe.clientX, pe.clientY, tipLines);
  });
  target.addEventListener("pointermove", (e) => {
    const pe = e as PointerEvent;
    showTimingTooltip(pe.clientX, pe.clientY, tipLines);
  });
  target.addEventListener("pointerleave", () => {
    hideTimingTooltip();
  });
}
