import { en } from "./en";
import { zh } from "./zh";
import type { Locale, UI } from "./types";

export type { FaqItem, Locale, UI } from "./types";

export const defaultLocale: Locale = "zh";
export const locales: Locale[] = ["zh", "en"];

const catalog: Record<Locale, UI> = { zh, en };

export function getTranslations(locale: Locale): UI {
  return catalog[locale];
}

export function getHtmlLang(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}

/** Path to a locale home page (respects Astro base). */
export function localeHomePath(locale: Locale, baseUrl = "/"): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  if (locale === defaultLocale) return base;
  return `${base}en/`;
}

/** Toggle link target for the language switcher. */
export function switchLocalePath(current: Locale, baseUrl = "/"): string {
  return localeHomePath(current === "zh" ? "en" : "zh", baseUrl);
}

export function docsUrl(locale: Locale): string {
  const repo = "https://github.com/FatMii/sse-devtools-panel";
  return locale === "zh" ? `${repo}/blob/main/README.zh-CN.md` : `${repo}#readme`;
}

export function screenshotUrl(file: string, baseUrl = "/"): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}screenshots/${file}`;
}
