import { describe, it, expect } from "vitest";
import {
  detectStreamKind,
  isGenericOrMissingContentType,
  payloadLooksLikeStreamTrue,
  resolveStreamKind,
  urlLooksLikeStreamQuery,
} from "../detect";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("detect", () => {
  it("matches previous script coverage", () => {
    assert(detectStreamKind("text/event-stream") === "sse", "sse ct");
    assert(detectStreamKind("application/json") === null, "json alone not a stream");
    assert(resolveStreamKind({ responseContentType: "text/event-stream" }) === "sse", "resolve ct");

    assert(
      resolveStreamKind({
        responseContentType: "application/json",
        requestHeaders: { accept: "text/event-stream" },
      }) === "sse",
      "accept event-stream",
    );

    assert(
      resolveStreamKind({
        responseContentType: "application/json",
        requestPayloadPreview: '{"model":"x","stream":true}',
      }) === "sse",
      "body stream true + json ct",
    );

    assert(
      resolveStreamKind({
        responseContentType: "application/json",
        url: "https://api.example.com/v1/chat/completions?stream=true",
      }) === "sse",
      "query stream=true",
    );

    assert(
      resolveStreamKind({
        responseContentType: "application/json",
        requestPayloadPreview: '{"model":"x"}',
      }) === null,
      "json without stream hint stays ignored",
    );

    assert(payloadLooksLikeStreamTrue('{"stream": true}') === true, "payload true");
    assert(payloadLooksLikeStreamTrue('{"stream":false}') === false, "payload false");
    assert(urlLooksLikeStreamQuery("/x?stream=true") === true, "url true");
    assert(isGenericOrMissingContentType(null) === true, "missing ct");
    assert(
      isGenericOrMissingContentType("application/json; charset=utf-8") === true,
      "json generic",
    );

    assert(
      resolveStreamKind({
        responseContentType: null,
        requestHeaders: { accept: "application/connect+json" },
      }) === "connect-json",
      "connect accept",
    );
  });
});
