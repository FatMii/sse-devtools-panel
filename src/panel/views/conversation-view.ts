import {
  conversationHasContent,
  syncConversationMergeSession,
  type AiConversation,
} from "../../shared/ai-merge";
import { t } from "../../shared/i18n";
import type { StreamRecord } from "../../shared/types";
import { elConversationBody, elConversationPlaceholder } from "../core/dom";
import { escapeHtml } from "../core/format";
import { renderIcon } from "../core/icons";
import { planTextPaneUpdate } from "./conversation-text";
import {
  CONV_ROW_HEIGHT_PX,
  computeConvVirtualWindow,
  estimateCols,
  isNearBottom,
  wrapTextToRows,
} from "./conversation-virtual";

type ConversationChannel = "content" | "reasoning" | "tools" | "meta";

type VirtualTextPane = {
  root: HTMLElement;
  topSpacer: HTMLElement;
  windowEl: HTMLElement;
  bottomSpacer: HTMLElement;
  text: string;
  rows: string[];
  cols: number;
  empty: boolean;
  paintedStart: number;
  paintedEnd: number;
  ro: ResizeObserver | null;
};

let conversationChannel: ConversationChannel = "content";
let conversationFingerprint = "";
/** Which tool cards stay expanded across Tools pane re-renders (per stream). */
let toolsExpandStreamId: string | null = null;
let toolsExpandedIndexes = new Set<number>();

let lastRenderedChannelText = "";
let lastRenderedStreamId: string | null = null;
let lastRenderedChannel: ConversationChannel | null = null;
let lastToolsFingerprint = "";
let latestMerged: AiConversation | null = null;
let activeVirtualPane: VirtualTextPane | null = null;

export type RenderConversationOptions = {
  copyText: (text: string, notify?: boolean) => Promise<void>;
  showToast: (message: string) => void;
};

export function resetConversationView(): void {
  disposeVirtualTextPane();
  conversationFingerprint = "";
  toolsExpandStreamId = null;
  toolsExpandedIndexes = new Set();
  lastRenderedChannelText = "";
  lastRenderedStreamId = null;
  lastRenderedChannel = null;
  lastToolsFingerprint = "";
  latestMerged = null;
}

function disposeVirtualTextPane(): void {
  if (!activeVirtualPane) return;
  activeVirtualPane.root.removeEventListener("scroll", onVirtualScroll);
  activeVirtualPane.ro?.disconnect();
  activeVirtualPane = null;
}

function onVirtualScroll(): void {
  if (activeVirtualPane) paintVirtualWindow(activeVirtualPane, false);
}

function paintVirtualWindow(pane: VirtualTextPane, force: boolean): void {
  if (pane.empty) {
    pane.topSpacer.style.height = "0px";
    pane.bottomSpacer.style.height = "0px";
    pane.paintedStart = 0;
    pane.paintedEnd = 0;
    return;
  }
  const win = computeConvVirtualWindow(
    pane.root.scrollTop,
    pane.root.clientHeight || 1,
    pane.rows.length,
  );
  if (!force && win.start === pane.paintedStart && win.end === pane.paintedEnd) {
    pane.topSpacer.style.height = `${win.paddingTop}px`;
    pane.bottomSpacer.style.height = `${win.paddingBottom}px`;
    return;
  }
  pane.topSpacer.style.height = `${win.paddingTop}px`;
  pane.bottomSpacer.style.height = `${win.paddingBottom}px`;
  pane.windowEl.textContent = pane.rows.slice(win.start, win.end).join("\n");
  pane.paintedStart = win.start;
  pane.paintedEnd = win.end;
}

function createVirtualTextPane(): VirtualTextPane {
  disposeVirtualTextPane();
  const root = document.createElement("div");
  root.className = "conversation-pane code conversation-virtual-pane";
  const topSpacer = document.createElement("div");
  topSpacer.className = "conversation-virtual-spacer";
  const windowEl = document.createElement("pre");
  windowEl.className = "conversation-virtual-window";
  const bottomSpacer = document.createElement("div");
  bottomSpacer.className = "conversation-virtual-spacer";
  root.append(topSpacer, windowEl, bottomSpacer);

  const pane: VirtualTextPane = {
    root,
    topSpacer,
    windowEl,
    bottomSpacer,
    text: "",
    rows: [],
    cols: 80,
    empty: true,
    paintedStart: -1,
    paintedEnd: -1,
    ro: null,
  };

  root.addEventListener("scroll", onVirtualScroll, { passive: true });
  pane.ro = new ResizeObserver(() => {
    if (!activeVirtualPane || activeVirtualPane !== pane || pane.empty) return;
    const nextCols = estimateCols(pane.root.clientWidth || 0);
    if (nextCols === pane.cols) {
      paintVirtualWindow(pane, true);
      return;
    }
    const near = isNearBottom(pane.root.scrollTop, pane.root.scrollHeight, pane.root.clientHeight);
    pane.cols = nextCols;
    pane.rows = wrapTextToRows(pane.text, nextCols);
    pane.paintedStart = -1;
    paintVirtualWindow(pane, true);
    if (near) pane.root.scrollTop = pane.rows.length * CONV_ROW_HEIGHT_PX;
  });
  pane.ro.observe(root);
  activeVirtualPane = pane;
  return pane;
}

function setVirtualText(pane: VirtualTextPane, nextText: string, showingEmpty: boolean): void {
  const emptyLabel = t("conversationEmpty");
  if (showingEmpty) {
    pane.empty = true;
    pane.text = "";
    pane.rows = [];
    pane.windowEl.textContent = emptyLabel;
    pane.windowEl.classList.add("is-empty");
    paintVirtualWindow(pane, true);
    lastRenderedChannelText = "";
    return;
  }

  const plan = planTextPaneUpdate(lastRenderedChannelText, nextText);
  const near = isNearBottom(pane.root.scrollTop, pane.root.scrollHeight, pane.root.clientHeight);
  pane.empty = false;
  pane.windowEl.classList.remove("is-empty");
  pane.cols = estimateCols(pane.root.clientWidth || 0);

  if (plan.mode === "noop" && pane.text === nextText && pane.rows.length > 0) {
    return;
  }

  pane.text = nextText;
  pane.rows = wrapTextToRows(nextText, pane.cols);
  pane.paintedStart = -1;
  paintVirtualWindow(pane, true);
  lastRenderedChannelText = nextText;
  if (near) pane.root.scrollTop = pane.rows.length * CONV_ROW_HEIGHT_PX;
}

function buildConversationFingerprint(
  merged: AiConversation,
  channel: ConversationChannel,
): string {
  return [
    merged.profile,
    merged.channels.content.length,
    merged.channels.reasoning.length,
    merged.channels.tools.length,
    merged.channels.tools.reduce((n, tc) => n + tc.arguments.length, 0),
    merged.endMeta.finishReason ?? "",
    merged.chunkCount,
    channel,
  ].join("|");
}

function toolsFingerprint(merged: AiConversation): string {
  return merged.channels.tools
    .map((tc) => `${tc.index}:${tc.name ?? ""}:${tc.arguments.length}:${tc.id ?? ""}`)
    .join("|");
}

function conversationChannelText(merged: AiConversation, channel: ConversationChannel): string {
  switch (channel) {
    case "content":
      return merged.channels.content;
    case "reasoning":
      return merged.channels.reasoning;
    case "tools":
      return merged.channels.tools.length
        ? merged.channels.tools
            .map((tc) => {
              const head = `#${tc.index}${tc.name ? ` ${tc.name}` : ""}${tc.id ? ` (${tc.id})` : ""}`;
              return `${head}\n${tc.arguments || "{}"}`;
            })
            .join("\n\n")
        : "";
    case "meta": {
      const lines: string[] = [
        `${t("conversationProfileLabel")}: ${merged.profile}`,
        `${t("conversationVendorLabel")}: ${merged.vendorHint}`,
        `${t("conversationChunksLabel")}: ${merged.chunkCount}`,
      ];
      if (merged.endMeta.model)
        lines.push(`${t("conversationModelLabel")}: ${merged.endMeta.model}`);
      if (merged.endMeta.finishReason) {
        lines.push(`${t("conversationFinishLabel")}: ${merged.endMeta.finishReason}`);
      }
      if (merged.endMeta.usage) {
        lines.push(`${t("conversationUsageLabel")}: ${JSON.stringify(merged.endMeta.usage)}`);
      }
      if (merged.detection.reasoningFields.length) {
        lines.push(
          `${t("conversationReasoningFieldsLabel")}: ${merged.detection.reasoningFields.join(", ")}`,
        );
      }
      return lines.join("\n");
    }
    default:
      return "";
  }
}

function tryParseToolArgs(raw: string): unknown | null {
  try {
    return JSON.parse(raw || "{}") as unknown;
  } catch {
    return null;
  }
}

function isWebSearchPayload(value: unknown): value is {
  type?: string;
  queries?: string[];
  results?: Array<Record<string, unknown>>;
  status?: unknown;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return o.type === "SEARCH" || Array.isArray(o.queries) || Array.isArray(o.results);
}

function toolsExpandedForStream(streamId: string, toolCount: number): Set<number> {
  if (toolsExpandStreamId !== streamId) {
    toolsExpandStreamId = streamId;
    toolsExpandedIndexes = new Set(toolCount > 0 ? [0] : []);
  }
  return toolsExpandedIndexes;
}

export function createToolsPane(merged: AiConversation, streamId: string): HTMLElement {
  const pane = document.createElement("div");
  pane.className = "conversation-pane conversation-tools-pane";

  if (merged.channels.tools.length === 0) {
    const empty = document.createElement("div");
    empty.className = "conversation-tools-empty";
    const unsupported = merged.profile === "generic";
    empty.textContent = unsupported
      ? t("conversationToolsUnsupported")
      : t("conversationToolsEmpty");
    pane.appendChild(empty);
    return pane;
  }

  const expanded = toolsExpandedForStream(streamId, merged.channels.tools.length);

  merged.channels.tools.forEach((tc, index) => {
    const card = document.createElement("article");
    const isOpen = expanded.has(index);
    card.className = "tool-card" + (isOpen ? " is-expanded" : " is-collapsed");
    card.dataset.toolIndex = String(index);
    const parsed = tryParseToolArgs(tc.arguments);
    const isSearch = tc.name === "web_search" || isWebSearchPayload(parsed);

    const head = document.createElement("button");
    head.type = "button";
    head.className = "tool-card-head";
    head.setAttribute("aria-expanded", isOpen ? "true" : "false");
    head.title = isOpen ? t("conversationToolsCollapse") : t("conversationToolsExpand");

    const caret = document.createElement("span");
    caret.className = "tool-card-caret";
    caret.innerHTML = renderIcon("caret", "tool-card-caret-icon");
    caret.setAttribute("aria-hidden", "true");

    const badge = document.createElement("span");
    badge.className = "tool-card-badge";
    badge.textContent = isSearch
      ? t("conversationToolsWebSearch")
      : tc.name || t("conversationToolsFunction");
    head.append(caret, badge);

    if (tc.id) {
      const idEl = document.createElement("span");
      idEl.className = "tool-card-id";
      idEl.textContent = tc.id;
      head.appendChild(idEl);
    }

    let summaryText = "";
    if (isSearch && isWebSearchPayload(parsed)) {
      const results = Array.isArray(parsed.results) ? parsed.results : [];
      summaryText = t("conversationToolsResults", String(results.length));
    } else if (tc.name) {
      summaryText = tc.name;
    }
    if (summaryText) {
      const summary = document.createElement("span");
      summary.className = "tool-card-summary";
      summary.textContent = summaryText;
      head.appendChild(summary);
    }

    const body = document.createElement("div");
    body.className = "tool-card-body";
    body.hidden = !isOpen;

    if (isSearch && isWebSearchPayload(parsed)) {
      const queries = Array.isArray(parsed.queries)
        ? parsed.queries.filter((q) => typeof q === "string")
        : [];
      if (queries.length > 0) {
        const qSection = document.createElement("div");
        qSection.className = "tool-card-section";
        const qLabel = document.createElement("div");
        qLabel.className = "tool-card-label";
        qLabel.textContent = t("conversationToolsQueries");
        const qList = document.createElement("div");
        qList.className = "tool-query-list";
        for (const q of queries) {
          const chip = document.createElement("span");
          chip.className = "tool-query-chip";
          chip.textContent = q;
          qList.appendChild(chip);
        }
        qSection.append(qLabel, qList);
        body.appendChild(qSection);
      }

      const results = Array.isArray(parsed.results) ? parsed.results : [];
      const rSection = document.createElement("div");
      rSection.className = "tool-card-section";
      const rLabel = document.createElement("div");
      rLabel.className = "tool-card-label";
      rLabel.textContent = t("conversationToolsResults", String(results.length));
      rSection.appendChild(rLabel);

      const list = document.createElement("ol");
      list.className = "tool-result-list";
      for (const r of results) {
        if (!r || typeof r !== "object") continue;
        const item = document.createElement("li");
        item.className = "tool-result-item";
        const cite =
          typeof r.cite_index === "number" || typeof r.cite_index === "string"
            ? String(r.cite_index)
            : "";
        const title = typeof r.title === "string" ? r.title : "Untitled";
        const url = typeof r.url === "string" ? r.url : "";
        const site = typeof r.site_name === "string" ? r.site_name : "";
        const snippet = typeof r.snippet === "string" ? r.snippet : "";

        const titleRow = document.createElement("div");
        titleRow.className = "tool-result-title-row";
        if (cite) {
          const citeEl = document.createElement("span");
          citeEl.className = "tool-result-cite";
          citeEl.textContent = cite;
          titleRow.appendChild(citeEl);
        }
        if (url) {
          const a = document.createElement("a");
          a.className = "tool-result-title";
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = title;
          titleRow.appendChild(a);
        } else {
          const span = document.createElement("span");
          span.className = "tool-result-title";
          span.textContent = title;
          titleRow.appendChild(span);
        }
        item.appendChild(titleRow);

        if (site || url) {
          const meta = document.createElement("div");
          meta.className = "tool-result-meta";
          meta.textContent = site || url;
          item.appendChild(meta);
        }
        if (snippet) {
          const sn = document.createElement("div");
          sn.className = "tool-result-snippet";
          sn.textContent = snippet;
          item.appendChild(sn);
        }
        list.appendChild(item);
      }
      rSection.appendChild(list);
      body.appendChild(rSection);
    } else {
      if (tc.name && !isSearch) {
        const nameRow = document.createElement("div");
        nameRow.className = "tool-card-section";
        const nameLabel = document.createElement("div");
        nameLabel.className = "tool-card-label";
        nameLabel.textContent = t("conversationToolsFunction");
        const nameVal = document.createElement("code");
        nameVal.className = "tool-fn-name";
        nameVal.textContent = tc.name;
        nameRow.append(nameLabel, nameVal);
        body.appendChild(nameRow);
      }
      const argsSection = document.createElement("div");
      argsSection.className = "tool-card-section";
      const argsLabel = document.createElement("div");
      argsLabel.className = "tool-card-label";
      argsLabel.textContent = t("conversationToolsArgs");
      const argsPre = document.createElement("pre");
      argsPre.className = "tool-args-pre";
      if (parsed != null) {
        try {
          argsPre.textContent = JSON.stringify(parsed, null, 2);
        } catch {
          argsPre.textContent = tc.arguments || "{}";
        }
      } else {
        argsPre.textContent = tc.arguments || "{}";
      }
      argsSection.append(argsLabel, argsPre);
      body.appendChild(argsSection);
    }

    head.addEventListener("click", () => {
      const nextOpen = !expanded.has(index);
      if (nextOpen) expanded.add(index);
      else expanded.delete(index);
      card.classList.toggle("is-expanded", nextOpen);
      card.classList.toggle("is-collapsed", !nextOpen);
      body.hidden = !nextOpen;
      head.setAttribute("aria-expanded", nextOpen ? "true" : "false");
      head.title = nextOpen ? t("conversationToolsCollapse") : t("conversationToolsExpand");
    });

    card.append(head, body);
    pane.appendChild(card);
  });

  return pane;
}

function channelSubtabLabel(merged: AiConversation, ch: ConversationChannel): string {
  const labels: Record<ConversationChannel, string> = {
    content: t("conversationChannelContent"),
    reasoning: t("conversationChannelReasoning"),
    tools: t("conversationChannelTools"),
    meta: t("conversationChannelMeta"),
  };
  let label = labels[ch];
  if (ch === "reasoning" && merged.channels.reasoning)
    label += ` (${merged.channels.reasoning.length})`;
  if (ch === "content" && merged.channels.content) label += ` (${merged.channels.content.length})`;
  if (ch === "tools" && merged.channels.tools.length) label += ` (${merged.channels.tools.length})`;
  return label;
}

function syncConversationChrome(shell: HTMLElement, merged: AiConversation): void {
  const chips = shell.querySelector(".conversation-chips");
  if (chips) {
    chips.replaceChildren();
    const chipProfile = document.createElement("span");
    chipProfile.className = "meta-chip conversation-chip";
    chipProfile.textContent = `${t("conversationProfileLabel")}: ${merged.profile}`;
    const chipVendor = document.createElement("span");
    chipVendor.className = "meta-chip conversation-chip";
    chipVendor.textContent = `${t("conversationVendorLabel")}: ${merged.vendorHint}`;
    chips.append(chipProfile, chipVendor);
    if (merged.endMeta.finishReason) {
      const chipFinish = document.createElement("span");
      chipFinish.className = "meta-chip conversation-chip";
      chipFinish.textContent = `${t("conversationFinishLabel")}: ${merged.endMeta.finishReason}`;
      chips.appendChild(chipFinish);
    }
  }

  const buttons = shell.querySelectorAll<HTMLButtonElement>(
    ".conversation-subtabs .request-subtab",
  );
  const channels: ConversationChannel[] = ["content", "reasoning", "tools", "meta"];
  buttons.forEach((btn, i) => {
    const ch = channels[i];
    if (!ch) return;
    btn.textContent = channelSubtabLabel(merged, ch);
    btn.classList.toggle("active", conversationChannel === ch);
  });
}

function mountFullConversation(
  record: StreamRecord,
  merged: AiConversation,
  options: RenderConversationOptions,
): void {
  elConversationPlaceholder.hidden = true;
  elConversationBody.hidden = false;
  disposeVirtualTextPane();
  elConversationBody.replaceChildren();

  const shell = document.createElement("div");
  shell.className = "conversation-shell";

  const toolbar = document.createElement("div");
  toolbar.className = "conversation-toolbar";

  const chips = document.createElement("div");
  chips.className = "conversation-chips";
  toolbar.append(chips);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "tool-btn tool-btn-icon";
  copyBtn.title = t("conversationCopyTitle");
  copyBtn.setAttribute("aria-label", t("conversationCopy"));
  copyBtn.innerHTML =
    renderIcon("copy", "tool-icon") +
    `<span class="visually-hidden">${escapeHtml(t("conversationCopy"))}</span>`;
  copyBtn.addEventListener("click", () => {
    const src = latestMerged ?? merged;
    const text = conversationChannelText(src, conversationChannel) || "";
    void options.copyText(text, false).then(() => options.showToast(t("conversationCopied")));
  });
  toolbar.append(copyBtn);

  const subtabs = document.createElement("div");
  subtabs.className = "conversation-subtabs request-subtabs";
  const channels: ConversationChannel[] = ["content", "reasoning", "tools", "meta"];
  for (const ch of channels) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "request-subtab" + (conversationChannel === ch ? " active" : "");
    btn.textContent = channelSubtabLabel(merged, ch);
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (conversationChannel === ch) return;
      conversationChannel = ch;
      conversationFingerprint = "";
      lastRenderedChannelText = "";
      lastRenderedChannel = null;
      lastToolsFingerprint = "";
      renderConversation(record, options);
    });
    subtabs.appendChild(btn);
  }

  const text = conversationChannelText(merged, conversationChannel);
  let pane: HTMLElement;
  let virtual: VirtualTextPane | null = null;
  if (conversationChannel === "tools") {
    disposeVirtualTextPane();
    pane = createToolsPane(merged, record.requestId);
    lastRenderedChannelText = "";
    lastToolsFingerprint = toolsFingerprint(merged);
  } else {
    virtual = createVirtualTextPane();
    pane = virtual.root;
  }

  shell.append(toolbar, subtabs, pane);
  syncConversationChrome(shell, merged);
  elConversationBody.appendChild(shell);
  if (virtual) {
    // Width is only known after the pane is in an active layout tree.
    setVirtualText(virtual, text, !text && conversationChannel !== "meta");
  }

  lastRenderedStreamId = record.requestId;
  lastRenderedChannel = conversationChannel;
}

/**
 * Render Conversation from an incremental merge session snapshot (O(Δ) push already done).
 */
export function renderConversation(
  record: StreamRecord | undefined,
  options: RenderConversationOptions,
): void {
  if (!record) {
    elConversationPlaceholder.hidden = false;
    elConversationPlaceholder.textContent = t("noStreamSelected");
    elConversationBody.hidden = true;
    disposeVirtualTextPane();
    elConversationBody.replaceChildren();
    conversationFingerprint = "";
    toolsExpandStreamId = null;
    toolsExpandedIndexes = new Set();
    lastRenderedChannelText = "";
    lastRenderedStreamId = null;
    lastRenderedChannel = null;
    lastToolsFingerprint = "";
    latestMerged = null;
    return;
  }

  const merged = syncConversationMergeSession(record.requestId, record.events, record.url);
  latestMerged = merged;

  const fp = buildConversationFingerprint(merged, conversationChannel);
  if (
    fp === conversationFingerprint &&
    elConversationBody.querySelector(".conversation-shell") &&
    !elConversationBody.hidden
  ) {
    return;
  }
  conversationFingerprint = fp;

  if (!conversationHasContent(merged) && merged.profile === "generic") {
    elConversationPlaceholder.hidden = false;
    elConversationPlaceholder.textContent = t("conversationEmpty");
    elConversationBody.hidden = true;
    disposeVirtualTextPane();
    elConversationBody.replaceChildren();
    lastRenderedChannelText = "";
    lastRenderedStreamId = null;
    lastRenderedChannel = null;
    lastToolsFingerprint = "";
    return;
  }

  const existingShell = elConversationBody.querySelector<HTMLElement>(".conversation-shell");
  const text = conversationChannelText(merged, conversationChannel);
  const canPatch =
    Boolean(existingShell) &&
    lastRenderedStreamId === record.requestId &&
    lastRenderedChannel === conversationChannel &&
    !elConversationBody.hidden;

  if (canPatch && existingShell) {
    syncConversationChrome(existingShell, merged);
    if (conversationChannel === "tools") {
      const tf = toolsFingerprint(merged);
      if (tf !== lastToolsFingerprint) {
        const next = createToolsPane(merged, record.requestId);
        const prev = existingShell.querySelector(".conversation-pane");
        if (prev) prev.replaceWith(next);
        else existingShell.appendChild(next);
        lastToolsFingerprint = tf;
      }
      return;
    }
    const paneEl = existingShell.querySelector<HTMLElement>(".conversation-virtual-pane");
    if (paneEl && activeVirtualPane && activeVirtualPane.root === paneEl) {
      setVirtualText(activeVirtualPane, text, !text && conversationChannel !== "meta");
      return;
    }
  }

  mountFullConversation(record, merged, options);
}
