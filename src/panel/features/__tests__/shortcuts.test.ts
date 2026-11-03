/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { isTextEntryTarget, matchPanelShortcut, PANEL_SHORTCUT_ROWS } from "../shortcuts";

function key(key: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, ctrlKey: false, metaKey: false, altKey: false, ...extra } as KeyboardEvent;
}

describe("matchPanelShortcut", () => {
  it("maps pause, search, export, and detail tabs", () => {
    expect(matchPanelShortcut(key("p"))).toBe("toggle-pause");
    expect(matchPanelShortcut(key("P"))).toBe("toggle-pause");
    expect(matchPanelShortcut(key("/"))).toBe("search-all");
    expect(matchPanelShortcut(key("e"))).toBe("export-json");
    expect(matchPanelShortcut(key("E"))).toBe("export-json");
    expect(matchPanelShortcut(key("1"))).toBe("tab-events");
    expect(matchPanelShortcut(key("2"))).toBe("tab-request");
    expect(matchPanelShortcut(key("3"))).toBe("tab-conversation");
    expect(matchPanelShortcut(key("4"))).toBe("tab-timing");
    expect(matchPanelShortcut(key("5"))).toBe("tab-raw");
    expect(matchPanelShortcut(key("?"))).toBe("show-shortcuts");
    expect(matchPanelShortcut(key("?", { shiftKey: true }))).toBe("show-shortcuts");
  });

  it("ignores modified keys and unbound keys", () => {
    expect(matchPanelShortcut(key("p", { ctrlKey: true }))).toBeNull();
    expect(matchPanelShortcut(key("e", { metaKey: true }))).toBeNull();
    expect(matchPanelShortcut(key("/", { altKey: true }))).toBeNull();
    expect(matchPanelShortcut(key("x"))).toBeNull();
    expect(matchPanelShortcut(key("ArrowLeft"))).toBeNull();
    expect(matchPanelShortcut(key("Escape"))).toBeNull();
  });
});

describe("PANEL_SHORTCUT_ROWS", () => {
  it("leads with the help key and lists the other commands", () => {
    expect(PANEL_SHORTCUT_ROWS[0]?.keys).toBe("?");
    expect(PANEL_SHORTCUT_ROWS.map((row) => row.keys)).toEqual([
      "?",
      "P",
      "/",
      "E",
      "1",
      "2",
      "3",
      "4",
      "5",
      "←  →",
      "Esc",
    ]);
  });
});

describe("isTextEntryTarget", () => {
  it("treats fields and contenteditable as typing targets", () => {
    document.body.innerHTML = `
      <input id="q" />
      <textarea id="t"></textarea>
      <select id="s"><option>a</option></select>
      <div id="edit" contenteditable="true"><span id="inner">x</span></div>
      <button id="btn">P</button>
    `;
    expect(isTextEntryTarget(document.getElementById("q"))).toBe(true);
    expect(isTextEntryTarget(document.getElementById("t"))).toBe(true);
    expect(isTextEntryTarget(document.getElementById("s"))).toBe(true);
    expect(isTextEntryTarget(document.getElementById("inner"))).toBe(true);
    expect(isTextEntryTarget(document.getElementById("btn"))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
