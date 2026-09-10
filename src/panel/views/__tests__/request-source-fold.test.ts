/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import {
  createCollapsibleSourceText,
  REQUEST_SOURCE_PREVIEW_CHARS,
} from "../request-source-fold";

describe("createCollapsibleSourceText", () => {
  it("renders short payloads without fold controls", () => {
    const el = createCollapsibleSourceText("hello", {
      onContextMenu: () => undefined,
    });
    expect(el.querySelector(".request-payload-text")?.textContent).toBe("hello");
    expect(el.querySelector(".request-source-fold-action")).toBeNull();
  });

  it("folds long payloads and expands on Show more", () => {
    const full = "z".repeat(REQUEST_SOURCE_PREVIEW_CHARS + 50);
    const el = createCollapsibleSourceText(full, {
      onContextMenu: () => undefined,
    });
    const pre = el.querySelector(".request-payload-text");
    const toggle = el.querySelector<HTMLButtonElement>(".request-source-fold-action");
    expect(pre?.textContent).toBe(full.slice(0, REQUEST_SOURCE_PREVIEW_CHARS) + "…");
    expect(toggle).toBeTruthy();
    expect(toggle?.title).toBeTruthy();

    toggle?.click();
    expect(pre?.textContent).toBe(full);
    expect(toggle?.title).toBe("");

    toggle?.click();
    expect(pre?.textContent).toBe(full.slice(0, REQUEST_SOURCE_PREVIEW_CHARS) + "…");
    expect(toggle?.title).toBeTruthy();
  });
});
