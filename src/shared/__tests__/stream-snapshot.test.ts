import { describe, it, expect } from "vitest";
import { buildStreamExportCsv, escapeCsvCell } from "../stream-snapshot";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("stream-snapshot", () => {
  it("matches previous script coverage", () => {
    assert(escapeCsvCell(null) === "", "null");
    assert(escapeCsvCell("plain") === "plain", "plain");
    assert(escapeCsvCell('a"b') === '"a""b"', "quote");
    assert(escapeCsvCell("a,b") === '"a,b"', "comma");
    assert(escapeCsvCell("a\nb") === '"a\nb"', "newline");

    const record = {
      requestId: "req-1",
      url: "https://example.com/sse",
      method: "GET",
      status: 200,
      transport: "fetch",
      streamKind: "sse",
      startedAt: 1,
      streamStatus: "done",
      raw: "data: hi\n\n",
      events: [
        {
          index: 0,
          event: "message",
          data: 'hello,"world"',
          receivedAt: 1_700_000_000_000,
          raw: 'data: hello,"world"\n\n',
        },
      ],
    };

    const csv = buildStreamExportCsv(record);
    assert(csv.startsWith("\uFEFF"), "BOM");
    assert(csv.includes("RequestId,URL,Method"), "header");
    assert(csv.includes('"hello,""world"""'), "escaped data");
    assert(csv.includes("req-1"), "request id");
  });
});
