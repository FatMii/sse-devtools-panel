import { setActiveTimingStallMs, TIMING_STALL_MS } from "./stream-timing";

export const TIMING_STALL_STORAGE_KEY = "timingStallMs";

export async function getTimingStallPreference(): Promise<number> {
  try {
    const data = await chrome.storage.sync.get({ [TIMING_STALL_STORAGE_KEY]: TIMING_STALL_MS });
    return setActiveTimingStallMs(data[TIMING_STALL_STORAGE_KEY]);
  } catch {
    return setActiveTimingStallMs(TIMING_STALL_MS);
  }
}

export async function setTimingStallPreference(value: unknown): Promise<number> {
  const next = setActiveTimingStallMs(value);
  await chrome.storage.sync.set({ [TIMING_STALL_STORAGE_KEY]: next });
  return next;
}

export async function initTimingStall(): Promise<number> {
  return getTimingStallPreference();
}

/** Panel listens so an Options change repaints Timing without a reload. */
export function onTimingStallChange(handler: (stallMs: number) => void): () => void {
  const onStorage = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
    if (area !== "sync" || !changes[TIMING_STALL_STORAGE_KEY]) return;
    handler(setActiveTimingStallMs(changes[TIMING_STALL_STORAGE_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(onStorage);
  return () => chrome.storage.onChanged.removeListener(onStorage);
}
