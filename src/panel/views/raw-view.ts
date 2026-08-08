import { elRaw } from "../core/dom";
import { planTextPaneUpdate } from "./conversation-text";

let lastRawStreamId: string | null = null;
let lastRawShown = "";

export function resetRawView(): void {
  lastRawStreamId = null;
  lastRawShown = "";
  elRaw.textContent = "";
}

/** Sync Raw pane from stream record. Call only when Raw tab is active (or clearing). */
export function renderRawView(
  record: { requestId: string; raw: string } | undefined,
  options?: { stickToBottom?: boolean },
): void {
  if (!record) {
    resetRawView();
    return;
  }

  const stick = options?.stickToBottom !== false;
  const nearBottom = elRaw.scrollTop + elRaw.clientHeight >= elRaw.scrollHeight - 48;
  const sameStream = lastRawStreamId === record.requestId;
  const plan =
    sameStream && lastRawShown.length > 0
      ? planTextPaneUpdate(lastRawShown, record.raw)
      : ({ mode: "replace", text: record.raw } as const);

  if (plan.mode === "noop") {
    lastRawStreamId = record.requestId;
    return;
  }

  if (plan.mode === "append") {
    elRaw.appendChild(document.createTextNode(plan.suffix));
  } else {
    elRaw.textContent = plan.text;
  }

  lastRawStreamId = record.requestId;
  lastRawShown = record.raw;

  if (stick && (nearBottom || !sameStream || plan.mode === "replace")) {
    elRaw.scrollTop = elRaw.scrollHeight;
  }
}
