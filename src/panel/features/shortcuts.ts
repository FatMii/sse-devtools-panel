/** Panel-level shortcuts. Single keys, no modifiers, ignored while typing. */

export type PanelShortcutAction =
  | "show-shortcuts"
  | "toggle-pause"
  | "search-all"
  | "export-json"
  | "tab-events"
  | "tab-request"
  | "tab-conversation"
  | "tab-timing"
  | "tab-raw";

const SHORTCUTS: Record<string, PanelShortcutAction> = {
  "?": "show-shortcuts",
  p: "toggle-pause",
  "/": "search-all",
  e: "export-json",
  "1": "tab-events",
  "2": "tab-request",
  "3": "tab-conversation",
  "4": "tab-timing",
  "5": "tab-raw",
};

/** Rows shown in the shortcuts dialog, including keys that are not commands. */
export const PANEL_SHORTCUT_ROWS: ReadonlyArray<{ keys: string; labelKey: string }> = [
  { keys: "?", labelKey: "shortcutShowList" },
  { keys: "P", labelKey: "shortcutPause" },
  { keys: "/", labelKey: "shortcutSearchAll" },
  { keys: "E", labelKey: "shortcutExportJson" },
  { keys: "1", labelKey: "shortcutTabEvents" },
  { keys: "2", labelKey: "shortcutTabRequest" },
  { keys: "3", labelKey: "shortcutTabConversation" },
  { keys: "4", labelKey: "shortcutTabTiming" },
  { keys: "5", labelKey: "shortcutTabRaw" },
  { keys: "←  →", labelKey: "shortcutDrawerNav" },
  { keys: "Esc", labelKey: "shortcutDismiss" },
];

export function matchPanelShortcut(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
): PanelShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return SHORTCUTS[key] ?? null;
}

/** True when the key should go to a field instead of a panel command. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  if (el.closest("input, textarea, select")) return true;
  const editable = el.closest<HTMLElement>("[contenteditable]");
  return Boolean(editable && editable.isContentEditable);
}
