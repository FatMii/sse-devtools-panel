import { classifyHttpStatus } from "../../shared/stream-close";
import type { StreamCloseReason, StreamTransport } from "../../shared/types";
import { guessStreamKindFromRequest, resolveStreamKind } from "./detect";
import { clipPayloadText, parseRawResponseHeaders, redactHeaderValue } from "./headers";
import type { PostChunk, PostDiscard, PostEnd, PostError, PostStart } from "./types";

/**
 * Capture incremental XHR text bodies for SSE / NDJSON responses.
 * Only observes readyState progression; does not alter request/response for the page.
 */
export function patchXhr(
  nextId: () => string,
  postStart: PostStart,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
  postDiscard: PostDiscard,
): void {
  const OriginalXHR = window.XMLHttpRequest;

  function PatchedXHR(this: XMLHttpRequest): XMLHttpRequest {
    const xhr = new OriginalXHR();
    let method = "GET";
    let url = "";
    const requestHeaders: Record<string, string> = {};
    let requestPayloadPreview: string | undefined;
    let requestPayloadTruncated: boolean | undefined;
    let requestId: string | null = null;
    let startedAt: number | undefined;
    let announced = false;
    let captured = false;
    let finished = false;
    let lastLen = 0;

    const originalOpen = xhr.open.bind(xhr);
    xhr.open = ((...args: Parameters<XMLHttpRequest["open"]>) => {
      method = String(args[0] ?? "GET").toUpperCase();
      url = String(args[1] ?? "");
      return originalOpen(...args);
    }) as XMLHttpRequest["open"];

    const originalSetRequestHeader = xhr.setRequestHeader.bind(xhr);
    xhr.setRequestHeader = ((name: string, value: string) => {
      requestHeaders[name.toLowerCase()] = redactHeaderValue(name, String(value));
      return originalSetRequestHeader(name, value);
    }) as XMLHttpRequest["setRequestHeader"];

    const originalSend = xhr.send.bind(xhr);
    xhr.send = ((body?: Document | XMLHttpRequestBodyInit | null) => {
      if (body == null) {
        requestPayloadPreview = undefined;
        requestPayloadTruncated = undefined;
      } else if (typeof body === "string") {
        const clipped = clipPayloadText(body);
        requestPayloadPreview = clipped.preview;
        requestPayloadTruncated = clipped.truncated;
      } else if (body instanceof URLSearchParams) {
        const clipped = clipPayloadText(body.toString());
        requestPayloadPreview = clipped.preview;
        requestPayloadTruncated = clipped.truncated;
      } else if (body instanceof FormData) {
        const fields: string[] = [];
        body.forEach((value, key) => {
          if (typeof value === "string") fields.push(`${key}=${value}`);
          else fields.push(`${key}=[blob:${value.type || "application/octet-stream"}]`);
        });
        const clipped = clipPayloadText(fields.join("&"));
        requestPayloadPreview = clipped.preview;
        requestPayloadTruncated = clipped.truncated;
      } else if (body instanceof Blob) {
        requestPayloadPreview = `[blob:${body.type || "application/octet-stream"}]`;
        requestPayloadTruncated = false;
      } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        const bytes = body.byteLength;
        requestPayloadPreview = `[binary:${bytes} bytes]`;
        requestPayloadTruncated = false;
      } else if (typeof Document !== "undefined" && body instanceof Document) {
        requestPayloadPreview = "[document]";
        requestPayloadTruncated = false;
      } else {
        requestPayloadPreview = "[payload]";
        requestPayloadTruncated = false;
      }

      const pendingKind = guessStreamKindFromRequest({
        requestHeaders: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
        url,
        requestPayloadPreview,
      });
      // Connect+JSON is binary — XHR cannot capture it; do not flash a pending row.
      if (pendingKind && pendingKind !== "connect-json") {
        requestId = nextId();
        startedAt = Date.now();
        announced = true;
        postStart({
          requestId,
          url,
          method,
          requestHeaders:
            Object.keys(requestHeaders).length > 0 ? { ...requestHeaders } : undefined,
          requestPayloadPreview,
          requestPayloadTruncated,
          transport: "xhr" satisfies StreamTransport,
          streamKind: pendingKind,
          startedAt,
        });
      }

      return originalSend(body);
    }) as XMLHttpRequest["send"];

    const tryStart = (): void => {
      if (captured || finished) return;
      if (xhr.readyState < OriginalXHR.HEADERS_RECEIVED) return;

      let contentType: string;
      try {
        contentType = xhr.getResponseHeader("content-type") ?? "";
      } catch {
        return;
      }

      const kind = resolveStreamKind({
        responseContentType: contentType,
        requestHeaders,
        url,
        requestPayloadPreview,
      });
      // Connect+JSON is binary length-prefixed — XHR responseText corrupts frames.
      if (!kind || kind === "connect-json") {
        if (announced && requestId) {
          postDiscard(requestId);
          announced = false;
          requestId = null;
        }
        return;
      }

      captured = true;
      if (!requestId) requestId = nextId();
      if (startedAt === undefined) startedAt = Date.now();
      lastLen = 0;

      let responseHeaders: Record<string, string> | undefined;
      let statusText: string | undefined;
      try {
        const raw = xhr.getAllResponseHeaders();
        if (raw) responseHeaders = parseRawResponseHeaders(raw);
      } catch {
        // ignore
      }
      try {
        statusText = xhr.statusText || undefined;
      } catch {
        // ignore
      }

      postStart({
        requestId,
        url,
        method,
        status: xhr.status || undefined,
        statusText,
        contentType: contentType || undefined,
        requestHeaders: Object.keys(requestHeaders).length > 0 ? { ...requestHeaders } : undefined,
        responseHeaders:
          responseHeaders && Object.keys(responseHeaders).length > 0 ? responseHeaders : undefined,
        requestPayloadPreview,
        requestPayloadTruncated,
        transport: "xhr" satisfies StreamTransport,
        streamKind: kind,
        startedAt,
      });
    };

    const emitDelta = (): void => {
      if (!captured || !requestId || finished) return;
      // responseText is only available for default / text responseType
      if (xhr.responseType && xhr.responseType !== "text") {
        return;
      }
      try {
        const text = xhr.responseText ?? "";
        if (text.length > lastLen) {
          const delta = text.slice(lastLen);
          lastLen = text.length;
          if (delta) {
            postChunk({ requestId, text: delta });
          }
        }
      } catch {
        // Ignore if responseText is inaccessible mid-flight
      }
    };

    const finishOk = (): void => {
      if (!captured || !requestId || finished) return;
      finished = true;
      emitDelta();
      postEnd({ requestId, endedAt: Date.now(), closeReason: "complete" });
    };

    const finishErr = (
      message: string,
      closeReason: Extract<StreamCloseReason, "abort" | "error" | "http_error">,
    ): void => {
      if (!captured || !requestId || finished) return;
      finished = true;
      emitDelta();
      postError({ requestId, message, endedAt: Date.now(), closeReason });
    };

    xhr.addEventListener("readystatechange", () => {
      tryStart();
      if (xhr.readyState === OriginalXHR.LOADING || xhr.readyState === OriginalXHR.DONE) {
        emitDelta();
      }
      if (xhr.readyState === OriginalXHR.DONE && captured) {
        if (xhr.status >= 400) {
          const classified = classifyHttpStatus(xhr.status);
          finishErr(classified.message, classified.closeReason);
        } else {
          finishOk();
        }
      }
    });

    xhr.addEventListener("error", () => {
      if (captured) {
        finishErr("XMLHttpRequest network error", "error");
      }
    });

    xhr.addEventListener("abort", () => {
      if (captured) {
        finishErr("XMLHttpRequest aborted", "abort");
      }
    });

    return xhr;
  }

  PatchedXHR.prototype = OriginalXHR.prototype;
  Object.defineProperties(PatchedXHR, {
    UNSENT: { value: OriginalXHR.UNSENT },
    OPENED: { value: OriginalXHR.OPENED },
    HEADERS_RECEIVED: { value: OriginalXHR.HEADERS_RECEIVED },
    LOADING: { value: OriginalXHR.LOADING },
    DONE: { value: OriginalXHR.DONE },
  });

  window.XMLHttpRequest = PatchedXHR as unknown as typeof XMLHttpRequest;
}
