import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  detectStreamKind,
  guessStreamKindFromRequest,
  isGenericOrMissingContentType,
  payloadLooksLikeStreamTrue,
  resolveStreamKind,
  urlLooksLikeStreamQuery,
  type ResolveStreamKindInput,
} from "../detect";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const captureCasesPath = resolve(repoRoot, "fixtures/vendors/capture-cases.json");

type CaptureCase = {
  name: string;
  expect?: string;
  input: ResolveStreamKindInput;
};

type CaptureCasesFile = {
  mustIgnore: CaptureCase[];
  mustCapture: CaptureCase[];
};

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

  it("enforces capture-cases.json (host alone never captures)", () => {
    assert(existsSync(captureCasesPath), `missing ${captureCasesPath}`);
    const cases = JSON.parse(readFileSync(captureCasesPath, "utf8")) as CaptureCasesFile;
    assert(Array.isArray(cases.mustIgnore) && cases.mustIgnore.length > 0, "mustIgnore empty");
    assert(Array.isArray(cases.mustCapture) && cases.mustCapture.length > 0, "mustCapture empty");

    for (const c of cases.mustIgnore) {
      const kind = resolveStreamKind(c.input);
      assert(kind === null, `mustIgnore ${c.name}: got ${kind}`);
    }
    for (const c of cases.mustCapture) {
      const kind = resolveStreamKind(c.input);
      assert(kind === c.expect, `mustCapture ${c.name}: got ${kind}, want ${c.expect}`);
    }
  });

  it("announces pending only from request-side stream hints", () => {
    assert(existsSync(captureCasesPath), `missing ${captureCasesPath}`);
    const cases = JSON.parse(readFileSync(captureCasesPath, "utf8")) as CaptureCasesFile;

    for (const c of cases.mustIgnore) {
      const { responseContentType: _ct, ...rest } = c.input;
      const kind = guessStreamKindFromRequest(rest);
      assert(kind === null, `pending mustIgnore ${c.name}: got ${kind}`);
    }

    for (const c of cases.mustCapture) {
      const { responseContentType: _ct, ...rest } = c.input;
      const kind = guessStreamKindFromRequest(rest);
      assert(kind === c.expect, `pending mustCapture ${c.name}: got ${kind}, want ${c.expect}`);
    }

    assert(
      guessStreamKindFromRequest({
        url: "https://api.example.com/v1/users",
        requestHeaders: { "content-type": "application/json", accept: "application/json" },
        requestPayloadPreview: '{"name":"x"}',
      }) === null,
      "ordinary json post is not pending",
    );
  });
});
