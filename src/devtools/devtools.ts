import { initI18n, t } from "../shared/i18n";

void initI18n().then(() => {
  chrome.devtools.panels.create(t("devtoolsPanelName"), "icons/icon-32.png", "panel/panel.html");
});
