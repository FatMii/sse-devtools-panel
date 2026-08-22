export type ThemeId = "light" | "night";
export type ThemePreference = "system" | ThemeId;

const STORAGE_KEY = "theme";

/** Chrome DevTools panels theme listener — not yet in @types/chrome. */
type DevToolsPanelsThemeApi = {
  onThemeChanged?: chrome.events.Event<() => void>;
};

let activePreference: ThemePreference = "system";
let activeTheme: ThemeId = "light";

export function getActiveThemePreference(): ThemePreference {
  return activePreference;
}

export function getActiveTheme(): ThemeId {
  return activeTheme;
}

/** Best-effort DevTools theme name (`default` | `dark`), or null when unavailable. */
export function getDevToolsThemeName(): string | null {
  try {
    const name = chrome.devtools?.panels?.themeName;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

export function resolveEffectiveTheme(
  pref: ThemePreference,
  devtoolsThemeName: string | null = getDevToolsThemeName(),
): ThemeId {
  if (pref === "light" || pref === "night") return pref;
  if (devtoolsThemeName === "dark") return "night";
  return "light";
}

export function applyTheme(themeId: ThemeId, root: HTMLElement = document.documentElement): void {
  if (themeId === "night") {
    root.dataset.theme = "night";
    root.style.colorScheme = "dark";
  } else {
    delete root.dataset.theme;
    root.style.colorScheme = "light";
  }
  activeTheme = themeId;
}

export async function getThemePreference(): Promise<ThemePreference> {
  try {
    const data = await chrome.storage.sync.get({ [STORAGE_KEY]: "system" as ThemePreference });
    const value = data[STORAGE_KEY] as ThemePreference;
    if (value === "light" || value === "night" || value === "system") return value;
  } catch {
    // ignore
  }
  return "system";
}

export async function setThemePreference(pref: ThemePreference): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: pref });
  activePreference = pref;
  applyTheme(resolveEffectiveTheme(pref));
}

export async function initTheme(): Promise<{ preference: ThemePreference; effective: ThemeId }> {
  const pref = await getThemePreference();
  activePreference = pref;
  applyTheme(resolveEffectiveTheme(pref));
  return { preference: pref, effective: activeTheme };
}

async function syncThemeFromStorage(): Promise<{
  preference: ThemePreference;
  effective: ThemeId;
}> {
  const pref = await getThemePreference();
  activePreference = pref;
  applyTheme(resolveEffectiveTheme(pref));
  return { preference: pref, effective: activeTheme };
}

/** Subscribe to preference storage changes and DevTools theme changes. */
export function onThemeChange(
  handler: (state: { preference: ThemePreference; effective: ThemeId }) => void,
): () => void {
  const notify = () => {
    void syncThemeFromStorage().then(handler);
  };

  const onStorage = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
    if (area !== "sync" || !changes[STORAGE_KEY]) return;
    notify();
  };
  chrome.storage.onChanged.addListener(onStorage);

  let removeDevToolsListener: (() => void) | null = null;
  try {
    const api = (chrome.devtools?.panels as DevToolsPanelsThemeApi | undefined)?.onThemeChanged;
    if (api?.addListener) {
      const onDevToolsTheme = () => notify();
      api.addListener(onDevToolsTheme);
      removeDevToolsListener = () => api.removeListener(onDevToolsTheme);
    }
  } catch {
    // ignore — not in DevTools context
  }

  return () => {
    chrome.storage.onChanged.removeListener(onStorage);
    removeDevToolsListener?.();
  };
}
