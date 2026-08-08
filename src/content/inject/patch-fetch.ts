import { classifyThrownError } from "../../shared/stream-close";
import type { StreamKind } from "../../shared/types";
import { detectStreamKind, looksLikeKimiConnectUrl, requestLooksLikeConnectJson } from "./detect";
import {
  collectFetchRequestMeta,
  normalizeResponseHeaders,
  resolveMethod,
  resolveUrl,
} from "./headers";
import { captureFetchResponseBody, createConnectJsonSink, createFetchTextSink } from "./stream";
import type { PostChunk, PostEnd, PostError, PostStart } from "./types";

export function patchFetch(
  nextId: () => string,
  postStart: PostStart,
  postChunk: PostChunk,
  postEnd: PostEnd,
  postError: PostError,
): void {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestId = nextId();
    const url = resolveUrl(input);
    const method = resolveMethod(input, init);
    const startedAt = Date.now();
    const reqMeta = await collectFetchRequestMeta(input, init);
    let announced = false;

    const announce = (extra: {
      status?: number;
      statusText?: string;
      contentType?: string;
      streamKind: StreamKind;
      url?: string;
      responseHeaders?: Record<string, string>;
    }): void => {
      postStart({
        requestId,
        url: extra.url ?? url,
        method,
        status: extra.status,
        statusText: extra.statusText,
        contentType: extra.contentType,
        requestHeaders: reqMeta.headers,
        responseHeaders: extra.responseHeaders,
        requestPayloadPreview: reqMeta.payloadPreview,
        requestPayloadTruncated: reqMeta.payloadTruncated,
        transport: "fetch",
        streamKind: extra.streamKind,
        startedAt,
      });
      announced = true;
    };

    const resolveFetchStreamKind = (contentType: string | null): StreamKind | null => {
      let streamKind = detectStreamKind(contentType);
      // Some gateways omit/mislabel CT; fall back to request Accept/Content-Type or host.
      if (!streamKind && requestLooksLikeConnectJson(reqMeta.headers)) {
        streamKind = "connect-json";
      }
      if (!streamKind && looksLikeKimiConnectUrl(url)) {
        streamKind = "connect-json";
      }
      return streamKind;
    };

    try {
      const response = await originalFetch(input, init);

      const contentType = response.headers.get("content-type");
      const streamKind = resolveFetchStreamKind(contentType);
      if (!streamKind) {
        return response;
      }

      announce({
        status: response.status,
        statusText: response.statusText || undefined,
        contentType: contentType ?? undefined,
        streamKind,
        url: response.url || url,
        responseHeaders: normalizeResponseHeaders(response.headers),
      });

      const sink =
        streamKind === "connect-json"
          ? createConnectJsonSink(requestId, postChunk, postEnd, postError)
          : createFetchTextSink(requestId, postChunk, postEnd, postError);
      return captureFetchResponseBody(response, sink);
    } catch (err) {
      if (announced) {
        const classified = classifyThrownError(err);
        postError({
          requestId,
          message: classified.message,
          endedAt: Date.now(),
          closeReason: classified.closeReason,
        });
      }
      throw err;
    }
  };
}
