import type { ParsedSseEvent } from "../shared/sse-parser";
import type { StreamRecord, StreamTransport } from "../shared/types";

export type StreamParser = {
  push(chunk: string): ParsedSseEvent[];
  flush(): ParsedSseEvent[];
};

export type ContextMenuData =
  { kind: "event-data"; data: string } | { kind: "json-node"; path: string; value?: string };

export type ActiveTab = "events" | "raw" | "timeline" | "request" | "transcript";

/** Shared mutable panel state — views import this; nothing imports panel.ts. */
export const state = {
  streams: new Map<string, StreamRecord>(),
  parsers: new Map<string, StreamParser>(),
  selectedId: null as string | null,
  selectedEventIndex: null as number | null,
  /** Data of the event currently shown in the drawer (for Copy). */
  drawerEventData: null as string | null,
  /** Index of the event currently shown in the drawer. */
  drawerEventIndex: null as number | null,
  /** Data targeted by the row / json-tree context menu. */
  contextMenuData: null as ContextMenuData | null,
  activeTab: "events" as ActiveTab,
  drawerWidthPercent: 42,
  eventsSearchQuery: "",
  drawerSearchQuery: "",
  streamsUrlFilterQuery: "",
  streamsTransportFilter: "all" as StreamTransport | "all",
  uiPaused: false,
  pendingListRefreshWhilePaused: false,
  pendingDetailRefreshWhilePaused: false,
};
