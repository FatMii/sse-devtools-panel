import { mergeAiTranscript, transcriptHasContent, type AiTranscript } from "../shared/ai-merge";
import { t } from "../shared/i18n";
import type { StreamRecord } from "../shared/types";
import { elTranscriptBody, elTranscriptPlaceholder } from "./dom";
import { escapeHtml } from "./format";
import { renderIcon } from "./icons";

type TranscriptChannel = "content" | "reasoning" | "tools" | "meta";

let transcriptChannel: TranscriptChannel = "content";
let transcriptFingerprint = "";
/** Which tool cards stay expanded across Tools pane re-renders (per stream). */
let toolsExpandStreamId: string | null = null;
let toolsExpandedIndexes = new Set<number>();

export type RenderTranscriptOptions = {
  copyText: (text: string, notify?: boolean) => Promise<void>;
  showToast: (message: string) => void;
};

export function resetTranscriptView(): void {
  transcriptFingerprint = "";
  toolsExpandStreamId = null;
  toolsExpandedIndexes = new Set();
}

function buildTranscriptFingerprint(record: StreamRecord, channel: TranscriptChannel): string {
  return [
    record.requestId,
    record.events.length,
    record.raw.length,
    record.streamStatus,
    channel,
  ].join("|");
}

function transcriptChannelText(merged: AiTranscript, channel: TranscriptChannel): string {
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
        `${t("transcriptProfileLabel")}: ${merged.profile}`,
        `${t("transcriptVendorLabel")}: ${merged.vendorHint}`,
        `${t("transcriptChunksLabel")}: ${merged.chunkCount}`,
      ];
      if (merged.endMeta.model) lines.push(`${t("transcriptModelLabel")}: ${merged.endMeta.model}`);
      if (merged.endMeta.finishReason) {
        lines.push(`${t("transcriptFinishLabel")}: ${merged.endMeta.finishReason}`);
      }
      if (merged.endMeta.usage) {
        lines.push(`${t("transcriptUsageLabel")}: ${JSON.stringify(merged.endMeta.usage)}`);
      }
      if (merged.detection.reasoningFields.length) {
        lines.push(
          `${t("transcriptReasoningFieldsLabel")}: ${merged.detection.reasoningFields.join(", ")}`,
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
    // Default: only the first tool's body/list is expanded.
    toolsExpandedIndexes = new Set(toolCount > 0 ? [0] : []);
  }
  return toolsExpandedIndexes;
}

export function createToolsPane(merged: AiTranscript, streamId: string): HTMLElement {
  const pane = document.createElement("div");
  pane.className = "transcript-pane transcript-tools-pane";

  if (merged.channels.tools.length === 0) {
    const empty = document.createElement("div");
    empty.className = "transcript-tools-empty";
    const unsupported = merged.profile === "generic";
    empty.textContent = unsupported ? t("transcriptToolsUnsupported") : t("transcriptToolsEmpty");
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
    head.title = isOpen ? t("transcriptToolsCollapse") : t("transcriptToolsExpand");

    const caret = document.createElement("span");
    caret.className = "tool-card-caret";
    caret.innerHTML = renderIcon("caret", "tool-card-caret-icon");
    caret.setAttribute("aria-hidden", "true");

    const badge = document.createElement("span");
    badge.className = "tool-card-badge";
    badge.textContent = isSearch
      ? t("transcriptToolsWebSearch")
      : tc.name || t("transcriptToolsFunction");
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
      summaryText = t("transcriptToolsResults", String(results.length));
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
        qLabel.textContent = t("transcriptToolsQueries");
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
      rLabel.textContent = t("transcriptToolsResults", String(results.length));
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
        nameLabel.textContent = t("transcriptToolsFunction");
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
      argsLabel.textContent = t("transcriptToolsArgs");
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
      head.title = nextOpen ? t("transcriptToolsCollapse") : t("transcriptToolsExpand");
    });

    card.append(head, body);
    pane.appendChild(card);
  });

  return pane;
}

export function renderTranscript(
  record: StreamRecord | undefined,
  options: RenderTranscriptOptions,
): void {
  if (!record) {
    elTranscriptPlaceholder.hidden = false;
    elTranscriptPlaceholder.textContent = t("noStreamSelected");
    elTranscriptBody.hidden = true;
    elTranscriptBody.innerHTML = "";
    transcriptFingerprint = "";
    toolsExpandStreamId = null;
    toolsExpandedIndexes = new Set();
    return;
  }

  const fp = buildTranscriptFingerprint(record, transcriptChannel);
  if (
    fp === transcriptFingerprint &&
    elTranscriptBody.querySelector(".transcript-shell") &&
    !elTranscriptBody.hidden
  ) {
    return;
  }
  transcriptFingerprint = fp;

  const merged = mergeAiTranscript(record.events, record.url);

  if (!transcriptHasContent(merged) && merged.profile === "generic") {
    elTranscriptPlaceholder.hidden = false;
    elTranscriptPlaceholder.textContent = t("transcriptEmpty");
    elTranscriptBody.hidden = true;
    elTranscriptBody.innerHTML = "";
    return;
  }

  elTranscriptPlaceholder.hidden = true;
  elTranscriptBody.hidden = false;
  elTranscriptBody.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "transcript-shell";

  const toolbar = document.createElement("div");
  toolbar.className = "transcript-toolbar";

  const chips = document.createElement("div");
  chips.className = "transcript-chips";
  const chipProfile = document.createElement("span");
  chipProfile.className = "meta-chip";
  chipProfile.textContent = `${t("transcriptProfileLabel")}: ${merged.profile}`;
  const chipVendor = document.createElement("span");
  chipVendor.className = "meta-chip";
  chipVendor.textContent = `${t("transcriptVendorLabel")}: ${merged.vendorHint}`;
  chips.append(chipProfile, chipVendor);
  if (merged.endMeta.finishReason) {
    const chipFinish = document.createElement("span");
    chipFinish.className = "meta-chip";
    chipFinish.textContent = `${t("transcriptFinishLabel")}: ${merged.endMeta.finishReason}`;
    chips.appendChild(chipFinish);
  }

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "tool-btn tool-btn-icon";
  copyBtn.title = t("transcriptCopyTitle");
  copyBtn.setAttribute("aria-label", t("transcriptCopy"));
  copyBtn.innerHTML =
    renderIcon("copy", "tool-icon") +
    `<span class="visually-hidden">${escapeHtml(t("transcriptCopy"))}</span>`;
  copyBtn.addEventListener("click", () => {
    const text = transcriptChannelText(merged, transcriptChannel) || "";
    void options.copyText(text, false).then(() => options.showToast(t("transcriptCopied")));
  });

  toolbar.append(chips, copyBtn);

  const subtabs = document.createElement("div");
  subtabs.className = "transcript-subtabs request-subtabs";
  const channels: TranscriptChannel[] = ["content", "reasoning", "tools", "meta"];
  const labels: Record<TranscriptChannel, string> = {
    content: t("transcriptChannelContent"),
    reasoning: t("transcriptChannelReasoning"),
    tools: t("transcriptChannelTools"),
    meta: t("transcriptChannelMeta"),
  };
  for (const ch of channels) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "request-subtab" + (transcriptChannel === ch ? " active" : "");
    let label = labels[ch];
    if (ch === "reasoning" && merged.channels.reasoning)
      label += ` (${merged.channels.reasoning.length})`;
    if (ch === "content" && merged.channels.content)
      label += ` (${merged.channels.content.length})`;
    if (ch === "tools" && merged.channels.tools.length)
      label += ` (${merged.channels.tools.length})`;
    btn.textContent = label;
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (transcriptChannel === ch) return;
      transcriptChannel = ch;
      transcriptFingerprint = "";
      renderTranscript(record, options);
    });
    subtabs.appendChild(btn);
  }

  const text = transcriptChannelText(merged, transcriptChannel);
  let pane: HTMLElement;
  if (transcriptChannel === "tools") {
    pane = createToolsPane(merged, record.requestId);
  } else {
    pane = document.createElement("pre");
    pane.className = "transcript-pane code";
    if (!text && transcriptChannel !== "meta") {
      pane.textContent = t("transcriptEmpty");
    } else {
      pane.textContent = text;
    }
  }

  shell.append(toolbar, subtabs, pane);
  elTranscriptBody.appendChild(shell);
}
