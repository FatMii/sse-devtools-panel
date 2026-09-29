import { describe, expect, it, vi } from "vitest";
import { conversationHasContent, mergeAiConversation } from "../../../shared/ai-merge";
import { TOUR_STEPS, TOUR_VERSION } from "../onboarding-tour";
import { buildTourSampleRecord } from "../tour-sample";

describe("tour-sample", () => {
  it("builds an importable stream with conversation content", () => {
    const record = buildTourSampleRecord();
    expect(record.origin).toBe("imported");
    expect(record.events.length).toBeGreaterThan(3);
    expect(record.url).toContain("deepseek");
    const merged = mergeAiConversation(record.events, record.url);
    expect(conversationHasContent(merged)).toBe(true);
    expect(merged.channels.content).toContain("SSE DevTools Panel");
  });
});

describe("onboarding-tour defs", () => {
  it("keeps a seven-step tour ending on More help", () => {
    expect(TOUR_VERSION).toBe(3);
    expect(TOUR_STEPS).toHaveLength(7);
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      "streams",
      "import",
      "events",
      "request",
      "conversation",
      "timeline",
      "more-help",
    ]);
    expect(TOUR_STEPS[6]?.openMoreMenu).toBe(true);
    for (const step of TOUR_STEPS) {
      expect(step.selector.startsWith("[data-tour=")).toBe(true);
    }
  });
});

describe("onboarding-tour storage", () => {
  it("marks and reads completion via chrome.storage.local", async () => {
    const store = new Map<string, unknown>();
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (key: string) => {
            const value = store.get(key);
            return value === undefined ? {} : { [key]: value };
          },
          set: async (items: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(items)) store.set(k, v);
          },
        },
      },
    });

    const { hasCompletedTour, markTourCompleted, TOUR_STORAGE_KEY } =
      await import("../onboarding-tour");
    expect(await hasCompletedTour()).toBe(false);
    await markTourCompleted();
    expect(store.get(TOUR_STORAGE_KEY)).toEqual({ completedVersion: TOUR_VERSION });
    expect(await hasCompletedTour()).toBe(true);
    vi.unstubAllGlobals();
  });
});
