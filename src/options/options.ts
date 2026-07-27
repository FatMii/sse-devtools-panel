import "./options.css";
import {
  applyDomI18n,
  getLocalePreference,
  initI18n,
  onLocaleChange,
  setLocalePreference,
  t,
  uiLanguage,
  type LocalePreference,
} from "../shared/i18n";

const select = document.getElementById("locale-select") as HTMLSelectElement;

async function refreshUi(): Promise<void> {
  await initI18n();
  document.documentElement.lang = uiLanguage();
  document.title = t("optionsTitle");
  applyDomI18n();
  // Re-apply option labels (data-i18n on <option>)
  select.querySelectorAll("option[data-i18n]").forEach((opt) => {
    const key = opt.getAttribute("data-i18n");
    if (key) opt.textContent = t(key);
  });
}

async function boot(): Promise<void> {
  await refreshUi();
  select.value = await getLocalePreference();

  select.addEventListener("change", async () => {
    const value = select.value as LocalePreference;
    await setLocalePreference(value);
    await refreshUi();
  });

  onLocaleChange(() => {
    void refreshUi();
  });
}

void boot();
