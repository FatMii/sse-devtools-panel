import {
  MESSAGE_SOURCE,
  PANEL_PORT,
  type PageToExtensionMessage,
  type RelayMessage,
} from "./shared/types";
import { estimateRelayBytes, RelayBuffer } from "./shared/relay-buffer";

/** tabId → set of DevTools panel ports */
const panelPorts = new Map<number, Set<chrome.runtime.Port>>();
/** Tabs currently replaying buffered messages onto a newly attached panel. */
const attachingTabs = new Set<number>();

const BUFFER_MAX_MESSAGES = 2_000;
const BUFFER_MAX_BYTES = 4 * 1024 * 1024;

type BufferedRelayMessage = { type: string; byteSize: number; relay: RelayMessage };

const tabBuffers = new Map<number, RelayBuffer<BufferedRelayMessage>>();

function isPageMessage(msg: unknown): msg is PageToExtensionMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as PageToExtensionMessage;
  return m.source === MESSAGE_SOURCE && typeof m.type === "string";
}

function bufferFor(tabId: number): RelayBuffer<BufferedRelayMessage> {
  let buf = tabBuffers.get(tabId);
  if (!buf) {
    buf = new RelayBuffer({
      maxMessages: BUFFER_MAX_MESSAGES,
      maxBytes: BUFFER_MAX_BYTES,
    });
    tabBuffers.set(tabId, buf);
  }
  return buf;
}

function hasLivePorts(tabId: number): boolean {
  const ports = panelPorts.get(tabId);
  return Boolean(ports && ports.size > 0);
}

function forwardToPorts(tabId: number, msg: RelayMessage): void {
  const ports = panelPorts.get(tabId);
  if (!ports || ports.size === 0) return;
  for (const port of ports) {
    try {
      port.postMessage(msg);
    } catch {
      // port dead
    }
  }
}

function enqueueOrForward(tabId: number, msg: RelayMessage): void {
  if (attachingTabs.has(tabId) || !hasLivePorts(tabId)) {
    bufferFor(tabId).push({
      type: msg.type,
      byteSize: estimateRelayBytes(msg),
      relay: msg,
    });
    return;
  }
  forwardToPorts(tabId, msg);
}

function replayToPort(port: chrome.runtime.Port, batch: BufferedRelayMessage[]): void {
  for (const item of batch) {
    try {
      port.postMessage(item.relay);
    } catch {
      return;
    }
  }
}

function attachPanel(tabId: number, port: chrome.runtime.Port): void {
  attachingTabs.add(tabId);
  try {
    for (;;) {
      const batch = bufferFor(tabId).drain();
      if (batch.length === 0) break;
      replayToPort(port, batch);
    }

    let set = panelPorts.get(tabId);
    if (!set) {
      set = new Set();
      panelPorts.set(tabId, set);
    }
    set.add(port);
  } finally {
    attachingTabs.delete(tabId);
  }

  // Messages buffered between last drain and live registration.
  for (;;) {
    const batch = bufferFor(tabId).drain();
    if (batch.length === 0) break;
    if (hasLivePorts(tabId)) {
      for (const item of batch) forwardToPorts(tabId, item.relay);
    } else {
      replayToPort(port, batch);
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT) return;

  let tabId: number | null = null;

  const onMessage = (msg: { type?: string; tabId?: number }) => {
    if (msg?.type === "init" && typeof msg.tabId === "number") {
      tabId = msg.tabId;
      attachPanel(tabId, port);
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
  enqueueOrForward(tabId, relay);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  panelPorts.delete(tabId);
  attachingTabs.delete(tabId);
  tabBuffers.delete(tabId);
});
