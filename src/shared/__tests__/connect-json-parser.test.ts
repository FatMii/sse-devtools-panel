import { describe, it, expect } from "vitest";
import { ConnectBinaryFramer, ConnectJsonParser } from "../connect-json-parser";

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

describe("connect-json-parser", () => {
  it("matches previous script coverage", () => {
    function encodeFrame(jsonText, flags = 0) {
      const payload = new TextEncoder().encode(jsonText);
      const out = new Uint8Array(5 + payload.length);
      out[0] = flags;
      out[1] = (payload.length >>> 24) & 0xff;
      out[2] = (payload.length >>> 16) & 0xff;
      out[3] = (payload.length >>> 8) & 0xff;
      out[4] = payload.length & 0xff;
      out.set(payload, 5);
      return out;
    }

    function concatBytes(...parts) {
      const total = parts.reduce((n, p) => n + p.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
      }
      return out;
    }

    {
      const framer = new ConnectBinaryFramer();
      const a = JSON.stringify({ op: "set", mask: "message", message: { role: "assistant" } });
      const b = JSON.stringify({ delta: { content: "你好" } });
      const wire = concatBytes(encodeFrame(a), encodeFrame(b), encodeFrame("", 0x02));
      // split across boundary mid-header
      const mid = 3;
      const part1 = framer.push(wire.subarray(0, mid));
      assert(part1.length === 0, "incomplete header yields 0");
      const part2 = framer.push(wire.subarray(mid));
      assert(part2.length === 3, `expected 3 frames got ${part2.length}`);
      assert(part2[0].jsonText === a, "frame0 json");
      assert(part2[1].jsonText === b, "frame1 json");
      assert(part2[2].endStream === true, "trailer endStream");
    }

    {
      const parser = new ConnectJsonParser();
      const e1 = parser.push('{"mask":"delta","delta":{"content":"hi"}}');
      assert(e1.length === 1, "one event");
      assert(e1[0].event === "delta", `event name ${e1[0].event}`);
      assert(e1[0].data.includes('"hi"'), "data");

      const e2 = parser.push('{"heartbeat":{}}{"mask":"message","message":{"role":"user"}}');
      assert(e2.length === 2, "concatenated objects");
      assert(e2[0].event === "heartbeat", "heartbeat event");
      assert(e2[1].event === "message", "message mask");
    }
  });
});
