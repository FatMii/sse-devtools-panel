import { t } from "../../shared/i18n";
import {
  elDialog,
  elDialogBody,
  elDialogTitle,
  elExportMenuBtn,
  elExportMenuPanel,
  elMoreMenuBtn,
  elMoreMenuPanel,
  elPauseUi,
  elStatusbarCapture,
  elToast,
  elToastText,
} from "./dom";
import { renderIcon } from "./icons";
import { state } from "./state";

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export type UiPauseResumeHooks = {
  renderList: () => void;
  renderDetail: (appendFriendly?: boolean) => void;
};

export function showToast(message: string): void {
  if (!elToast || !elToastText) return;
  elToastText.textContent = message;
  elToast.hidden = false;
  if (toastTimer != null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (elToast) elToast.hidden = true;
    toastTimer = null;
  }, 2200);
}

export function closeAllMenus(): void {
  if (elExportMenuPanel) elExportMenuPanel.hidden = true;
  if (elMoreMenuPanel) elMoreMenuPanel.hidden = true;
  elExportMenuBtn?.setAttribute("aria-expanded", "false");
  elMoreMenuBtn?.setAttribute("aria-expanded", "false");
}

export function toggleMenu(panel: HTMLDivElement | null, btn: HTMLButtonElement | null): void {
  if (!panel || !btn) return;
  const willOpen = panel.hidden;
  closeAllMenus();
  if (willOpen) {
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }
}

export function closeAppDialog(): void {
  if (elDialog.open) elDialog.close();
  elDialogBody.innerHTML = "";
  elDialogTitle.textContent = "";
}

export function openAppDialog(title: string, body: HTMLElement): void {
  elDialogTitle.textContent = title;
  elDialogBody.innerHTML = "";
  elDialogBody.appendChild(body);
  if (!elDialog.open) elDialog.showModal();
}

export function setUiPaused(next: boolean, hooks: UiPauseResumeHooks): void {
  state.uiPaused = next;
  elPauseUi.classList.toggle("is-paused", state.uiPaused);
  const label = elPauseUi.querySelector(".tool-label");
  if (label) {
    label.textContent = state.uiPaused ? t("resumeUi") : t("pauseUi");
  }
  const icon = elPauseUi.querySelector("svg.tool-icon");
  if (icon) {
    icon.outerHTML = renderIcon(state.uiPaused ? "play" : "pause", "tool-icon");
  }
  elPauseUi.title = state.uiPaused ? t("resumeUiTitle") : t("pauseUiTitle");
  if (elStatusbarCapture) {
    elStatusbarCapture.textContent = state.uiPaused
      ? t("statusbarUiPaused")
      : t("statusbarCaptureActive");
    elStatusbarCapture.classList.toggle("is-paused", state.uiPaused);
  }
  if (!state.uiPaused) {
    if (state.pendingListRefreshWhilePaused) hooks.renderList();
    if (state.pendingDetailRefreshWhilePaused) hooks.renderDetail(true);
    state.pendingListRefreshWhilePaused = false;
    state.pendingDetailRefreshWhilePaused = false;
  }
}

export async function copyText(text: string, notify = false): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  if (notify) showToast(t("toastCopied"));
}

export function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
