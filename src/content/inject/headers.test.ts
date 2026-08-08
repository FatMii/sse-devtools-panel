import { describe, it, expect } from "vitest";
import { isSensitiveHeaderName, normalizeHeaders, redactHeaderValue } from "./headers";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("headers", () => {
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
