import type { PageToExtensionMessage, RelayMessage } from "./shared/types";

const PANEL_PORT = "sse-devtools-panel";

/** tabId → set of DevTools panel ports */
const panelPorts = new Map<number, Set<chrome.runtime.Port>>();

function isPageMessage(msg: unknown): msg is PageToExtensionMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as PageToExtensionMessage;
  return m.source === "sse-devtools" && typeof m.type === "string";
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT) return;

  let tabId: number | null = null;

  const onMessage = (msg: { type?: string; tabId?: number }) => {
    if (msg?.type === "init" && typeof msg.tabId === "number") {
      tabId = msg.tabId;
      let set = panelPorts.get(tabId);
      if (!set) {
        set = new Set();
        panelPorts.set(tabId, set);
      }
      set.add(port);
    }
  };

  port.onMessage.addListener(onMessage);

  port.onDisconnect.addListener(() => {
    port.onMessage.removeListener(onMessage);
    if (tabId !== null) {
      const set = panelPorts.get(tabId);
      if (set) {
        set.delete(port);
        if (set.size === 0) {
          panelPorts.delete(tabId);
        }
      }
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!isPageMessage(message)) return;
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return;

  const relay: RelayMessage = { ...message, tabId };
  const ports = panelPorts.get(tabId);
  if (!ports || ports.size === 0) return;

  for (const port of ports) {
    try {
      port.postMessage(relay);
    } catch {
      // port dead
    }
  }
});
