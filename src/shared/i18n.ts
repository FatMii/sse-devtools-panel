import enCatalog from "../../_locales/en/messages.json";
import zhCNCatalog from "../../_locales/zh_CN/messages.json";

export type LocaleId = "en" | "zh_CN";
export type LocalePreference = "system" | LocaleId;

const STORAGE_KEY = "locale";

type MessageEntry = {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string; example?: string }>;
};

type Catalog = Record<string, MessageEntry>;

const catalogs: Record<LocaleId, Catalog> = {
  en: enCatalog as Catalog,
  zh_CN: zhCNCatalog as Catalog,
};

let activeLocale: LocaleId = "en";
let ready = false;

export function getActiveLocale(): LocaleId {
  return activeLocale;
}

/** Map Chrome UI language → supported locale. */
export function localeFromBrowser(): LocaleId {
  try {
    const ui = chrome.i18n.getUILanguage().toLowerCase();
    if (ui.startsWith("zh")) return "zh_CN";
  } catch {
    // ignore
  }
  return "en";
}

export async function getLocalePreference(): Promise<LocalePreference> {
  try {
    const data = await chrome.storage.sync.get({ [STORAGE_KEY]: "system" as LocalePreference });
    const value = data[STORAGE_KEY] as LocalePreference;
    if (value === "en" || value === "zh_CN" || value === "system") return value;
  } catch {
    // ignore
  }
  return "system";
}

export async function setLocalePreference(pref: LocalePreference): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: pref });
}

function resolveLocale(pref: LocalePreference): LocaleId {
  if (pref === "en" || pref === "zh_CN") return pref;
  return localeFromBrowser();
}

/** Load preference and set active catalog. Call before using `t()`. */
export async function initI18n(): Promise<LocaleId> {
  const pref = await getLocalePreference();
  activeLocale = resolveLocale(pref);
  ready = true;
  return activeLocale;
}

export function t(key: string, substitutions?: string | string[]): string {
  const catalog = catalogs[activeLocale] ?? catalogs.en;
  const entry = catalog[key] ?? catalogs.en[key];
  if (!entry) return key;

  let msg = entry.message;
  const subs =
    substitutions == null ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];

  if (entry.placeholders) {
    for (const [name, meta] of Object.entries(entry.placeholders)) {
      const m = /^\$(\d+)$/.exec(meta.content.trim());
      const idx = m ? Number(m[1]) - 1 : -1;
      const value = idx >= 0 ? (subs[idx] ?? "") : "";
      msg = msg.replace(new RegExp(`\\$${name}\\$`, "gi"), value);
    }
  } else {
    subs.forEach((value, i) => {
      msg = msg.replaceAll(`$${i + 1}`, value);
    });
  }

  return msg;
}

export function uiLanguage(): string {
  return activeLocale === "zh_CN" ? "zh-CN" : "en";
}

/** Apply data-i18n / data-i18n-title / data-i18n-placeholder on the document. */
export function applyDomI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    el.textContent = t(key);
  });

  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (!key) return;
    el.title = t(key);
  });

  root.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    el.placeholder = t(key);
  });
}

export function isI18nReady(): boolean {
  return ready;
}

/** Subscribe to locale preference changes. */
export function onLocaleChange(handler: (locale: LocaleId) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
    if (area !== "sync" || !changes[STORAGE_KEY]) return;
    void initI18n().then(handler);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
