import { t, uiLanguage } from "../../shared/i18n";
import {
  looksLikeUrlEncoded,
  parseQueryStringParams,
  parseUrlEncodedPairs,
  requestContentType,
  type NameValuePair,
} from "../../shared/request-view";
import type { StreamRecord } from "../../shared/types";
import { elRequestBody, elRequestPlaceholder } from "../core/dom";
import { closeReasonLabel, escapeHtml, transportLabel } from "../core/format";
import { createJsonTree, tryParseJsonValue } from "../widgets/json-tree";

let requestPane: "headers" | "payload" = "headers";
let requestPayloadView: "parsed" | "source" = "parsed";
/** Skip Request tab DOM rebuild while streaming if request meta did not change. */
let requestViewFingerprint = "";

export type RenderRequestOptions = {
  onBindJsonTreeContextMenu: (tree: HTMLElement) => void;
};

export function resetRequestViewState(): void {
  requestViewFingerprint = "";
}

export function createNameValueTable(
  pairs: NameValuePair[],
  options?: { redactValues?: boolean },
): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "request-headers-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>${escapeHtml(t("requestHeaderName"))}</th>
        <th>${escapeHtml(t("requestHeaderValue"))}</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");
  for (const pair of pairs) {
    const tr = document.createElement("tr");
    const isRedacted = options?.redactValues && pair.value === "[REDACTED]";
    tr.innerHTML = `
      <td class="request-header-name"><code>${escapeHtml(pair.name)}</code></td>
      <td class="request-header-value${isRedacted ? " is-redacted" : ""}"><code>${escapeHtml(pair.value)}</code></td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

export function headersToPairs(headers?: Record<string, string>): NameValuePair[] {
  if (!headers) return [];
  return Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({ name, value }));
}

export function appendKvRow(parent: HTMLElement, label: string, value: string): void {
  const row = document.createElement("div");
  row.className = "request-kv-row";
  row.innerHTML = `<span>${escapeHtml(label)}</span><code class="request-url">${escapeHtml(value)}</code>`;
  parent.appendChild(row);
}

export function buildRequestViewFingerprint(record: StreamRecord): string {
  return [
    uiLanguage(),
    record.requestId,
    record.url,
    record.method,
    String(record.status ?? ""),
    record.statusText ?? "",
    record.contentType ?? "",
    record.transport,
    record.streamKind,
    String(record.requestPayloadTruncated ?? false),
    record.requestPayloadPreview ?? "",
    JSON.stringify(record.requestHeaders ?? null),
    JSON.stringify(record.responseHeaders ?? null),
  ].join("\n");
}

export function switchRequestPane(pane: "headers" | "payload"): void {
  requestPane = pane;
  const headersTab = elRequestBody.querySelector<HTMLButtonElement>(
    '.request-subtab[data-request-pane="headers"]',
  );
  const payloadTab = elRequestBody.querySelector<HTMLButtonElement>(
    '.request-subtab[data-request-pane="payload"]',
  );
  const paneHeaders = elRequestBody.querySelector<HTMLElement>(".request-pane-headers");
  const panePayload = elRequestBody.querySelector<HTMLElement>(".request-pane-payload");
  if (!headersTab || !payloadTab || !paneHeaders || !panePayload) return;
  headersTab.classList.toggle("active", pane === "headers");
  payloadTab.classList.toggle("active", pane === "payload");
  paneHeaders.hidden = pane !== "headers";
  panePayload.hidden = pane !== "payload";
}

export function renderRequest(
  record: StreamRecord | undefined,
  options: RenderRequestOptions,
): void {
  if (!record) {
    requestViewFingerprint = "";
    elRequestPlaceholder.hidden = false;
    elRequestPlaceholder.textContent = t("noStreamSelected");
    elRequestBody.hidden = true;
    elRequestBody.innerHTML = "";
    return;
  }

  const fingerprint = buildRequestViewFingerprint(record);
  if (
    fingerprint === requestViewFingerprint &&
    elRequestBody.querySelector(".request-subtabs") &&
    !elRequestBody.hidden
  ) {
    // Keep current Headers/Payload selection while stream chunks keep refreshing detail.
    return;
  }
  requestViewFingerprint = fingerprint;

  elRequestPlaceholder.hidden = true;
  elRequestBody.hidden = false;
  elRequestBody.innerHTML = "";

  const subtabs = document.createElement("div");
  subtabs.className = "request-subtabs";
  const headersTab = document.createElement("button");
  headersTab.type = "button";
  headersTab.dataset.requestPane = "headers";
  headersTab.className = "request-subtab" + (requestPane === "headers" ? " active" : "");
  headersTab.textContent = t("requestPaneHeaders");
  const payloadTab = document.createElement("button");
  payloadTab.type = "button";
  payloadTab.dataset.requestPane = "payload";
  payloadTab.className = "request-subtab" + (requestPane === "payload" ? " active" : "");
  payloadTab.textContent = t("requestPanePayload");
  subtabs.append(headersTab, payloadTab);
  elRequestBody.appendChild(subtabs);

  const paneHeaders = document.createElement("div");
  paneHeaders.className = "request-pane request-pane-headers";
  paneHeaders.hidden = requestPane !== "headers";

  const panePayload = document.createElement("div");
  panePayload.className = "request-pane request-pane-payload";
  panePayload.hidden = requestPane !== "payload";

  // ---- Headers ----
  const general = document.createElement("section");
  general.className = "request-section";
  const generalTitle = document.createElement("div");
  generalTitle.className = "request-section-title";
  generalTitle.textContent = t("requestGeneralTitle");
  general.appendChild(generalTitle);
  const generalKv = document.createElement("div");
  generalKv.className = "request-kv";
  appendKvRow(generalKv, t("requestUrl"), record.url);
  appendKvRow(generalKv, t("requestMethod"), record.method);
  if (record.status != null) {
    const statusText =
      record.statusText && record.statusText.trim()
        ? `${record.status} ${record.statusText}`
        : String(record.status);
    appendKvRow(generalKv, t("requestStatus"), statusText);
  }
  appendKvRow(generalKv, t("requestTransport"), transportLabel(record.transport));
  appendKvRow(generalKv, t("requestStreamKind"), record.streamKind);
  if (record.contentType) {
    appendKvRow(generalKv, t("requestContentType"), record.contentType);
  }
  if (record.closeReason) {
    appendKvRow(generalKv, t("requestCloseReason"), closeReasonLabel(record.closeReason));
  }
  if (record.errorMessage) {
    appendKvRow(generalKv, t("requestErrorMessage"), record.errorMessage);
  }
  if (record.lastEventId) {
    appendKvRow(generalKv, t("requestLastEventId"), record.lastEventId);
  }
  if ((record.reconnectCount ?? 0) > 0) {
    appendKvRow(generalKv, t("requestReconnectCount"), String(record.reconnectCount));
  }
  general.appendChild(generalKv);
  paneHeaders.appendChild(general);

  const responseSection = document.createElement("section");
  responseSection.className = "request-section";
  const responseTitle = document.createElement("div");
  responseTitle.className = "request-section-title";
  responseTitle.textContent = t("requestResponseHeadersTitle");
  responseSection.appendChild(responseTitle);
  const responsePairs = headersToPairs(record.responseHeaders);
  if (responsePairs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "request-empty";
    empty.textContent = t("requestResponseHeadersEmpty");
    responseSection.appendChild(empty);
  } else {
    responseSection.appendChild(createNameValueTable(responsePairs, { redactValues: true }));
  }
  paneHeaders.appendChild(responseSection);

  const requestHeadersSection = document.createElement("section");
  requestHeadersSection.className = "request-section";
  const requestHeadersTitle = document.createElement("div");
  requestHeadersTitle.className = "request-section-title";
  requestHeadersTitle.textContent = t("requestHeadersTitle");
  requestHeadersSection.appendChild(requestHeadersTitle);
  const requestHeadersHint = document.createElement("div");
  requestHeadersHint.className = "request-section-hint";
  requestHeadersHint.textContent = t("requestHeadersHint");
  requestHeadersSection.appendChild(requestHeadersHint);
  const requestPairs = headersToPairs(record.requestHeaders);
  if (requestPairs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "request-empty";
    empty.textContent = t("requestHeadersEmpty");
    requestHeadersSection.appendChild(empty);
  } else {
    requestHeadersSection.appendChild(createNameValueTable(requestPairs, { redactValues: true }));
  }
  paneHeaders.appendChild(requestHeadersSection);

  // ---- Payload ----
  const queryParams = parseQueryStringParams(record.url);
  const querySection = document.createElement("section");
  querySection.className = "request-section";
  const queryTitle = document.createElement("div");
  queryTitle.className = "request-section-title";
  queryTitle.textContent = t("requestQueryTitle");
  querySection.appendChild(queryTitle);
  if (queryParams.length === 0) {
    const empty = document.createElement("div");
    empty.className = "request-empty";
    empty.textContent = t("requestQueryEmpty");
    querySection.appendChild(empty);
  } else {
    querySection.appendChild(createNameValueTable(queryParams));
  }
  panePayload.appendChild(querySection);

  const payload = record.requestPayloadPreview ?? "";
  const reqCt = (requestContentType(record.requestHeaders) ?? "").toLowerCase();
  const isForm =
    reqCt.includes("application/x-www-form-urlencoded") ||
    (!reqCt.includes("json") && looksLikeUrlEncoded(payload));
  const formPairs = isForm && payload ? parseUrlEncodedPairs(payload) : [];

  if (formPairs.length > 0) {
    const formSection = document.createElement("section");
    formSection.className = "request-section";
    const formTitle = document.createElement("div");
    formTitle.className = "request-section-title";
    formTitle.textContent = t("requestFormDataTitle");
    formSection.appendChild(formTitle);
    formSection.appendChild(createNameValueTable(formPairs));
    if (record.requestPayloadTruncated) {
      const hint = document.createElement("div");
      hint.className = "request-section-hint";
      hint.textContent = t("requestBodyTruncatedHint");
      formSection.appendChild(hint);
    }
    panePayload.appendChild(formSection);
  }

  const bodySection = document.createElement("section");
  bodySection.className = "request-section";
  const bodyTitleRow = document.createElement("div");
  bodyTitleRow.className = "request-section-title-row";
  const bodyTitle = document.createElement("div");
  bodyTitle.className = "request-section-title";
  bodyTitle.textContent = t("requestBodyTitle");
  bodyTitleRow.appendChild(bodyTitle);

  const viewToggle = document.createElement("div");
  viewToggle.className = "request-view-toggle";
  const parsedBtn = document.createElement("button");
  parsedBtn.type = "button";
  parsedBtn.className = "request-view-btn" + (requestPayloadView === "parsed" ? " active" : "");
  parsedBtn.textContent = t("requestPayloadParsed");
  const sourceBtn = document.createElement("button");
  sourceBtn.type = "button";
  sourceBtn.className = "request-view-btn" + (requestPayloadView === "source" ? " active" : "");
  sourceBtn.textContent = t("requestPayloadSource");
  viewToggle.append(parsedBtn, sourceBtn);
  bodyTitleRow.appendChild(viewToggle);
  bodySection.appendChild(bodyTitleRow);

  const bodyHint = document.createElement("div");
  bodyHint.className = "request-section-hint";
  bodyHint.textContent = record.requestPayloadTruncated
    ? t("requestBodyTruncatedHint")
    : t("requestBodyHint");
  bodySection.appendChild(bodyHint);

  const bodyContent = document.createElement("div");
  bodyContent.className = "request-payload-content";

  const renderPayloadContent = (): void => {
    bodyContent.innerHTML = "";
    parsedBtn.classList.toggle("active", requestPayloadView === "parsed");
    sourceBtn.classList.toggle("active", requestPayloadView === "source");
    if (!payload) {
      const empty = document.createElement("div");
      empty.className = "request-empty";
      empty.textContent = t("requestBodyEmpty");
      bodyContent.appendChild(empty);
      return;
    }
    if (requestPayloadView === "source") {
      const pre = document.createElement("pre");
      pre.className = "request-payload-text";
      pre.textContent = payload;
      bodyContent.appendChild(pre);
      return;
    }
    const parsed = tryParseJsonValue(payload);
    if (parsed.ok) {
      const tree = createJsonTree(parsed.value, { defaultExpandDepth: 2 });
      options.onBindJsonTreeContextMenu(tree);
      bodyContent.appendChild(tree);
      return;
    }
    if (formPairs.length > 0) {
      bodyContent.appendChild(createNameValueTable(formPairs));
      return;
    }
    const pre = document.createElement("pre");
    pre.className = "request-payload-text";
    pre.textContent = payload;
    bodyContent.appendChild(pre);
  };

  parsedBtn.addEventListener("click", () => {
    requestPayloadView = "parsed";
    renderPayloadContent();
  });
  sourceBtn.addEventListener("click", () => {
    requestPayloadView = "source";
    renderPayloadContent();
  });
  renderPayloadContent();
  bodySection.appendChild(bodyContent);
  panePayload.appendChild(bodySection);

  elRequestBody.append(paneHeaders, panePayload);

  // pointerdown: streaming detail refresh can destroy buttons between mousedown/mouseup.
  headersTab.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    switchRequestPane("headers");
  });
  payloadTab.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    switchRequestPane("payload");
  });
}
