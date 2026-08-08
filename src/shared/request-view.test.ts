import { describe, it, expect } from "vitest";
import { looksLikeUrlEncoded, parseQueryStringParams, parseUrlEncodedPairs } from "./request-view";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("request-view", () => {
  it("matches previous script coverage", () => {
    const q = parseQueryStringParams("https://example.com/chat?model=gpt&n=1&model=alt");
    assert(q.length === 3, "query count");
    assert(q[0].name === "model" && q[0].value === "gpt", "first query");

    const form = parseUrlEncodedPairs("a=1&b=hello%20world&empty=");
    assert(form[0].value === "1", "form a");
    assert(form[1].value === "hello world", "form decode");
    assert(form[2].name === "empty" && form[2].value === "", "empty value");

    assert(looksLikeUrlEncoded("a=1&b=2"), "urlencoded yes");
    assert(!looksLikeUrlEncoded('{"a":1}'), "json no");
  });
});
