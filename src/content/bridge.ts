import { MESSAGE_SOURCE, type PageToExtensionMessage } from "../shared/types";

function isPageMessage(data: unknown): data is PageToExtensionMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as PageToExtensionMessage;
  return msg.source === MESSAGE_SOURCE && typeof msg.type === "string" && "payload" in msg;
}

window.addEventListener("message", (event: MessageEvent) => {
  // Only accept messages from the same window
  if (event.source !== window) return;
  if (!isPageMessage(event.data)) return;

  try {
    chrome.runtime.sendMessage(event.data);
  } catch {
    // Extension context invalidated (reload) — ignore
  }
});
