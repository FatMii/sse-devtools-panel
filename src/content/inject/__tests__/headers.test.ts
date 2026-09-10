import { describe, it, expect } from "vitest";
import {
  clipPayloadText,
  isSensitiveHeaderName,
  MAX_PAYLOAD_PREVIEW,
  normalizeHeaders,
  redactHeaderValue,
} from "../headers";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("headers", () => {
  it("keeps typical large payloads intact under the soft ceiling", () => {
    const mid = "x".repeat(512_000);
    const clipped = clipPayloadText(mid);
    expect(clipped.truncated).toBe(false);
    expect(clipped.preview).toBe(mid);
    expect(MAX_PAYLOAD_PREVIEW).toBe(8_000_000);
  });

  it("clips only when exceeding the soft ceiling", () => {
    const huge = "y".repeat(MAX_PAYLOAD_PREVIEW + 10);
    const clipped = clipPayloadText(huge);
    expect(clipped.truncated).toBe(true);
    expect(clipped.preview.length).toBe(MAX_PAYLOAD_PREVIEW);
    expect(clipped.preview).toBe(huge.slice(0, MAX_PAYLOAD_PREVIEW));
  });

  it("matches previous script coverage", () => {
    for (const name of [
      "Authorization",
      "Cookie",
      "Set-Cookie",
      "Proxy-Authorization",
      "x-api-key",
      "api-key",
      "X-Auth-Token",
      "x-access-token",
      "private-token",
      "X-CSRF-Token",
      "x-session-token",
      "X-Goog-Api-Key",
    ]) {
      assert(isSensitiveHeaderName(name), `sensitive: ${name}`);
      assert(redactHeaderValue(name, "secret") === "[REDACTED]", `redact: ${name}`);
    }

    for (const name of ["content-type", "accept", "x-request-id", "user-agent", "cache-control"]) {
      assert(!isSensitiveHeaderName(name), `not sensitive: ${name}`);
      assert(redactHeaderValue(name, "keep") === "keep", `keep: ${name}`);
    }

    const normalized = normalizeHeaders({
      Authorization: "Bearer abc",
      "X-Access-Token": "tok",
      Accept: "text/event-stream",
    });
    assert(normalized.authorization === "[REDACTED]", "normalize auth");
    assert(normalized["x-access-token"] === "[REDACTED]", "normalize access token");
    assert(normalized.accept === "text/event-stream", "normalize accept");
  });
});
