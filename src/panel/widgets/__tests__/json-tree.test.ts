/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { formatApproxSize } from "../../core/format";
import { renderHighlightedText } from "../../core/highlight-text";
import { compileTextFilter } from "../../../shared/text-filter";
import {
  JSON_STRING_PREVIEW_CHARS,
  applyTreeSearch,
  createJsonTree,
  formatCollapsedJsonString,
} from "../json-tree";

describe("formatApproxSize", () => {
  it("formats bytes / KB / MB", () => {
    expect(formatApproxSize(0)).toBe("0 B");
    expect(formatApproxSize(120)).toBe("120 B");
    expect(formatApproxSize(2048)).toBe("2.0 KB");
    expect(formatApproxSize(1024 * 1024)).toBe("1.0 MB");
  });
});

describe("formatCollapsedJsonString", () => {
  it("returns full JSON string under the preview limit", () => {
    expect(formatCollapsedJsonString("hello")).toBe('"hello"');
  });

  it("truncates long strings with ellipsis inside quotes", () => {
    const raw = "a".repeat(JSON_STRING_PREVIEW_CHARS + 20);
    const out = formatCollapsedJsonString(raw);
    expect(out.startsWith('"')).toBe(true);
    expect(out.endsWith('"')).toBe(true);
    expect(out.includes("…")).toBe(true);
    expect(out.length).toBeLessThan(JSON.stringify(raw).length);
  });
});

describe("renderHighlightedText", () => {
  it("wraps matching substrings in search-mark", () => {
    const el = document.createElement("span");
    renderHighlightedText(el, "hello world", compileTextFilter("wor"));
    const marks = el.querySelectorAll("mark.search-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("wor");
    expect(el.textContent).toBe("hello world");
  });

  it("uses plain text when filter is empty", () => {
    const el = document.createElement("span");
    renderHighlightedText(el, "plain", compileTextFilter(""));
    expect(el.querySelector("mark")).toBeNull();
    expect(el.textContent).toBe("plain");
  });
});

describe("applyTreeSearch fine-grained highlights", () => {
  it("marks matching substrings inside leaf values and keeps search-match row class", () => {
    const tree = createJsonTree({ message: "hello world" }, { defaultExpandDepth: 2 });
    const count = applyTreeSearch(tree, "wor");
    expect(count).toBeGreaterThan(0);

    const leaf = tree.querySelector<HTMLElement>(".json-leaf.search-match");
    expect(leaf).not.toBeNull();

    const marks = leaf!.querySelectorAll("mark.search-mark");
    expect(marks.length).toBeGreaterThan(0);
    expect([...marks].every((m) => m.textContent === "wor")).toBe(true);

    const valueText = leaf!.querySelector(".json-value")?.textContent ?? "";
    expect(valueText).toContain("hello world");
    expect(valueText).not.toBe("wor");
  });

  it("auto-expands collapsed long strings when the hit is only in the truncated tail", () => {
    const uniqueTail = "UNIQUE_TAIL_TOKEN_XYZ";
    const raw = `${"a".repeat(JSON_STRING_PREVIEW_CHARS)}${uniqueTail}`;
    const tree = createJsonTree({ blob: raw }, { defaultExpandDepth: 2 });

    const valBefore = tree.querySelector<HTMLElement>(".json-value.json-string");
    expect(valBefore).not.toBeNull();
    expect(valBefore!.classList.contains("is-expanded")).toBe(false);
    expect(valBefore!.textContent?.includes(uniqueTail)).toBe(false);

    applyTreeSearch(tree, uniqueTail);

    const valAfter = tree.querySelector<HTMLElement>(".json-value.json-string");
    expect(valAfter).not.toBeNull();
    expect(valAfter!.classList.contains("is-expanded")).toBe(true);
    expect(valAfter!.textContent?.includes(uniqueTail)).toBe(true);

    const marks = valAfter!.querySelectorAll("mark.search-mark");
    expect(marks.length).toBeGreaterThan(0);
    expect([...marks].some((m) => m.textContent === uniqueTail)).toBe(true);
  });

  it("clears marks and search-match when query is emptied", () => {
    const tree = createJsonTree({ message: "hello world" }, { defaultExpandDepth: 2 });
    applyTreeSearch(tree, "hello");
    expect(tree.querySelector("mark.search-mark")).not.toBeNull();
    expect(tree.querySelector(".search-match")).not.toBeNull();

    applyTreeSearch(tree, "");
    expect(tree.querySelector("mark.search-mark")).toBeNull();
    expect(tree.querySelector(".search-match")).toBeNull();
    expect(tree.querySelector(".json-value")?.textContent).toBe('"hello world"');
  });
});
