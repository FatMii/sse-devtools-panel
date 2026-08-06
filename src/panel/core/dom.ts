export const elList = document.getElementById("stream-list") as HTMLUListElement;
export const elEmpty = document.getElementById("empty-hint") as HTMLDivElement;
export const elMeta = document.getElementById("meta") as HTMLDivElement;
export const elMetaMethod = document.getElementById("meta-method") as HTMLSpanElement;
export const elMetaUrl = document.getElementById("meta-url") as HTMLSpanElement;
export const elMetaTags = document.getElementById("meta-tags") as HTMLDivElement;
export const elEvents = document.getElementById("view-events") as HTMLDivElement;
export const elPlaceholder = document.getElementById("events-placeholder") as HTMLDivElement;
export const elTableWrap = document.getElementById("events-table-wrap") as HTMLDivElement;
export const elTbody = document.getElementById("events-tbody") as HTMLTableSectionElement;
export const elEventsSearch = document.getElementById("events-search") as HTMLInputElement;
export const elResizer = document.getElementById("events-resizer") as HTMLDivElement;
export const elSidebarResizer = document.getElementById("sidebar-resizer") as HTMLDivElement;
export const elDrawer = document.getElementById("events-drawer") as HTMLElement;
export const elDrawerTitle = document.getElementById("drawer-title") as HTMLSpanElement;
export const elDrawerBody = document.getElementById("drawer-body") as HTMLDivElement;
export const elDrawerSearch = document.getElementById("drawer-search") as HTMLInputElement;
export const elDrawerClose = document.getElementById("drawer-close") as HTMLButtonElement;
export const elDrawerPrev = document.getElementById("drawer-prev") as HTMLButtonElement;
export const elDrawerNext = document.getElementById("drawer-next") as HTMLButtonElement;
export const elDrawerCopy = document.getElementById("drawer-copy") as HTMLButtonElement;
export const elContextMenu = document.getElementById("row-context-menu") as HTMLDivElement;
export const elMenuCopyData = elContextMenu.querySelector<HTMLButtonElement>(
  'button[data-action="copy-data"]',
);
export const elMenuCopyJsonValue = elContextMenu.querySelector<HTMLButtonElement>(
  'button[data-action="copy-json-value"]',
);
export const elMenuCopyJsonPath = elContextMenu.querySelector<HTMLButtonElement>(
  'button[data-action="copy-json-path"]',
);
export const elRaw = document.getElementById("raw-body") as HTMLPreElement;
export const elTimelinePlaceholder = document.getElementById(
  "timeline-placeholder",
) as HTMLDivElement;
export const elTimelineBody = document.getElementById("timeline-body") as HTMLDivElement;
export const elRequestPlaceholder = document.getElementById(
  "request-placeholder",
) as HTMLDivElement;
export const elRequestBody = document.getElementById("request-body") as HTMLDivElement;
export const elTranscriptPlaceholder = document.getElementById(
  "transcript-placeholder",
) as HTMLDivElement;
export const elTranscriptBody = document.getElementById("transcript-body") as HTMLDivElement;
export const elStreamsUrlFilter = document.getElementById("streams-url-filter") as HTMLInputElement;
export const elStreamsTransportFilter = document.getElementById(
  "streams-transport-filter",
) as HTMLSelectElement;
export const elExportJson = document.getElementById("btn-export-json") as HTMLButtonElement;
export const elExportCsv = document.getElementById("btn-export-csv") as HTMLButtonElement;
export const elExportFixture = document.getElementById("btn-export-fixture") as HTMLButtonElement;
export const elImportJson = document.getElementById("btn-import-json") as HTMLButtonElement;
export const elPauseUi = document.getElementById("btn-pause-ui") as HTMLButtonElement;
export const elImportFile = document.getElementById("import-file") as HTMLInputElement;
export const elSaveArchive = document.getElementById("btn-save-archive") as HTMLButtonElement;
export const elArchives = document.getElementById("btn-archives") as HTMLButtonElement;
export const elStats = document.getElementById("btn-stats") as HTMLButtonElement;
export const elAnomalies = document.getElementById("btn-anomalies") as HTMLButtonElement;
export const elSpecWarnings = document.getElementById("btn-spec-warnings") as HTMLButtonElement;
export const elSearchAll = document.getElementById("btn-search-all") as HTMLButtonElement;
export const elDialog = document.getElementById("app-dialog") as HTMLDialogElement;
export const elDialogTitle = document.getElementById("app-dialog-title") as HTMLSpanElement;
export const elDialogBody = document.getElementById("app-dialog-body") as HTMLDivElement;
export const elDialogClose = document.getElementById("app-dialog-close") as HTMLButtonElement;
export const elStreamsCount = document.getElementById("streams-count") as HTMLSpanElement | null;
export const elStatusbarCapture = document.getElementById(
  "statusbar-capture",
) as HTMLSpanElement | null;
export const elStatusbarLocale = document.getElementById(
  "statusbar-locale",
) as HTMLSpanElement | null;
export const elEventsFilterHint = document.getElementById(
  "events-filter-hint",
) as HTMLSpanElement | null;
export const elTabCountEvents = document.getElementById(
  "tab-count-events",
) as HTMLSpanElement | null;
export const elTabCountRaw = document.getElementById("tab-count-raw") as HTMLSpanElement | null;
export const elTabCountTranscript = document.getElementById(
  "tab-count-transcript",
) as HTMLSpanElement | null;
export const elToast = document.getElementById("toast") as HTMLDivElement | null;
export const elToastText = document.getElementById("toast-text") as HTMLSpanElement | null;
export const elExportMenu = document.getElementById("export-menu") as HTMLDivElement | null;
export const elExportMenuBtn = document.getElementById(
  "btn-export-menu",
) as HTMLButtonElement | null;
export const elExportMenuPanel = document.getElementById(
  "export-menu-panel",
) as HTMLDivElement | null;
export const elMoreMenu = document.getElementById("more-menu") as HTMLDivElement | null;
export const elMoreMenuBtn = document.getElementById("btn-more-menu") as HTMLButtonElement | null;
export const elMoreMenuPanel = document.getElementById("more-menu-panel") as HTMLDivElement | null;
