import { afterEach, describe, expect, it, vi } from "vitest";
import { getTimingStallMs, setActiveTimingStallMs, TIMING_STALL_MS } from "../stream-timing";
import {
  getTimingStallPreference,
  setTimingStallPreference,
  TIMING_STALL_STORAGE_KEY,
} from "../timing-stall";

describe("timing stall preference", () => {
  afterEach(() => {
    setActiveTimingStallMs(TIMING_STALL_MS);
    vi.unstubAllGlobals();
  });

  it("stores a clamped threshold and reads it back", async () => {
    const store = new Map<string, unknown>();
    vi.stubGlobal("chrome", {
      storage: {
        sync: {
          get: async (defaults: Record<string, unknown>) => {
            const key = TIMING_STALL_STORAGE_KEY;
            return { [key]: store.has(key) ? store.get(key) : defaults[key] };
          },
          set: async (items: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(items)) store.set(key, value);
          },
        },
      },
    });

    expect(await getTimingStallPreference()).toBe(400);
    expect(await setTimingStallPreference(250.6)).toBe(251);
    expect(store.get(TIMING_STALL_STORAGE_KEY)).toBe(251);
    expect(getTimingStallMs()).toBe(251);
    expect(await setTimingStallPreference(1)).toBe(50);
    expect(await setTimingStallPreference("")).toBe(400);
    expect(await getTimingStallPreference()).toBe(400);
  });
});
