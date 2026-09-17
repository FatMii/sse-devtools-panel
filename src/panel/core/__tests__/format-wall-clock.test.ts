import { describe, it, expect, vi, afterEach } from "vitest";
import { formatTimeShort } from "../format";

describe("formatTimeShort", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats local HH:mm:ss without milliseconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T06:32:01.435Z"));
    const ts = Date.now();
    expect(formatTimeShort(ts)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatTimeShort(ts)).not.toContain(".");
  });
});
