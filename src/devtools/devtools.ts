import { initI18n, t } from "../shared/i18n";

void initI18n().then(() => {
  chrome.devtools.panels.create(t("devtoolsPanelName"), "", "panel/panel.html", () => {
    // Panel created
  });
});
