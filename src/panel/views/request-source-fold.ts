import { t } from "../../shared/i18n";
import { formatApproxSize } from "../core/format";

/** Collapsed Source preview length (full text stays in memory for Copy / Show more). */
export const REQUEST_SOURCE_PREVIEW_CHARS = 4_000;

/**
 * Source view: fold long payloads like Network — Show more expands DOM; Copy uses full text.
 */
export function createCollapsibleSourceText(
  fullText: string,
  options: {
    previewChars?: number;
    onContextMenu: (x: number, y: number, data: string) => void;
  },
): HTMLElement {
  const previewChars = options.previewChars ?? REQUEST_SOURCE_PREVIEW_CHARS;
  const wrap = document.createElement("div");
  wrap.className = "request-source-fold";

  if (fullText.length <= previewChars) {
    const pre = document.createElement("pre");
    pre.className = "request-payload-text";
    pre.textContent = fullText;
    pre.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      options.onContextMenu(e.clientX, e.clientY, fullText);
    });
    wrap.appendChild(pre);
    return wrap;
  }

  const pre = document.createElement("pre");
  pre.className = "request-payload-text";
  pre.textContent = fullText.slice(0, previewChars) + "…";
  pre.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    options.onContextMenu(e.clientX, e.clientY, fullText);
  });

  const toolbar = document.createElement("div");
  toolbar.className = "request-source-fold-toolbar";

  const meta = document.createElement("span");
  meta.className = "request-source-fold-meta";
  meta.textContent = t("jsonStringSize", formatApproxSize(fullText.length));

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "request-source-fold-action";
  toggleBtn.textContent = t("requestSourceShowMore");
  toggleBtn.title = t("requestSourceExpandLagTitle");

  let expanded = false;
  toggleBtn.addEventListener("click", () => {
    expanded = !expanded;
    pre.textContent = expanded ? fullText : fullText.slice(0, previewChars) + "…";
    toggleBtn.textContent = expanded ? t("requestSourceShowLess") : t("requestSourceShowMore");
    toggleBtn.title = expanded ? "" : t("requestSourceExpandLagTitle");
  });

  toolbar.append(meta, toggleBtn);
  wrap.append(pre, toolbar);
  return wrap;
}
