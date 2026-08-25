import { describe, it, expect } from "vitest";
import { formatApproxSize } from "../../core/format";
import { JSON_STRING_PREVIEW_CHARS, formatCollapsedJsonString } from "../json-tree";

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
