import { describe, expect, it } from "vitest";
import { resolveEffectiveTheme } from "../theme";

describe("theme", () => {
  it("returns explicit light and night preferences", () => {
    expect(resolveEffectiveTheme("light", "dark")).toBe("light");
    expect(resolveEffectiveTheme("night", "default")).toBe("night");
  });

  it("maps system preference from DevTools themeName", () => {
    expect(resolveEffectiveTheme("system", "dark")).toBe("night");
    expect(resolveEffectiveTheme("system", "default")).toBe("light");
  });

  it("falls back to light when DevTools theme API is unavailable", () => {
    expect(resolveEffectiveTheme("system", null)).toBe("light");
  });
});
