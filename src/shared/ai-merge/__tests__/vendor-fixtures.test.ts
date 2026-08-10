import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { conversationHasContent, mergeAiConversation } from "../index";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const vendorsRoot = resolve(repoRoot, "fixtures/vendors");

const REQUIRED_VENDORS = ["deepseek", "doubao", "kimi", "qwen", "chatglm", "yuanbao"] as const;

type FixtureEvent = { data: string; event?: string };

type FixtureExpect = {
  url: string;
  profile: string;
  vendorHint: string;
  reasoningIncludes?: string[];
  contentIncludes?: string[];
  contentExcludes?: string[];
  minTools?: number;
  toolName?: string;
  finishReason?: string;
};

function assert(cond: unknown, msg: string): asserts cond {
  expect(cond, msg).toBeTruthy();
}

function loadJson<T>(path: string, label: string): T {
  assert(existsSync(path), `missing required fixture: ${label} (${path})`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("vendor fixtures (CI-required)", () => {
  it("keeps required vendor directories in fixtures/vendors", () => {
    assert(existsSync(vendorsRoot), `fixtures/vendors missing at ${vendorsRoot}`);
    const dirs = new Set(
      readdirSync(vendorsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name),
    );
    for (const vendor of REQUIRED_VENDORS) {
      assert(dirs.has(vendor), `required vendor fixture dir missing: ${vendor}`);
    }
  });

  for (const vendor of REQUIRED_VENDORS) {
    it(`merges ${vendor} fixture without skipping`, () => {
      const dir = join(vendorsRoot, vendor);
      const eventsPath = join(dir, "events.json");
      const expectPath = join(dir, "expect.json");
      const events = loadJson<FixtureEvent[]>(eventsPath, `${vendor}/events.json`);
      const exp = loadJson<FixtureExpect>(expectPath, `${vendor}/expect.json`);

      assert(Array.isArray(events) && events.length > 0, `${vendor}: events.json empty`);
      assert(typeof exp.url === "string" && exp.url, `${vendor}: expect.url required`);

      const normalized = events.map((e) => ({
        data: e.data,
        event: e.event ?? "message",
      }));

      const merged = mergeAiConversation(normalized, exp.url);
      assert(merged.profile === exp.profile, `${vendor} profile got ${merged.profile}`);
      assert(merged.vendorHint === exp.vendorHint, `${vendor} vendorHint got ${merged.vendorHint}`);

      for (const snip of exp.reasoningIncludes ?? []) {
        assert(
          merged.channels.reasoning.includes(snip),
          `${vendor} reasoning missing ${JSON.stringify(snip)}: ${merged.channels.reasoning.slice(0, 120)}`,
        );
      }
      for (const snip of exp.contentIncludes ?? []) {
        assert(
          merged.channels.content.includes(snip),
          `${vendor} content missing ${JSON.stringify(snip)}: ${merged.channels.content.slice(0, 120)}`,
        );
      }
      for (const snip of exp.contentExcludes ?? []) {
        assert(
          !merged.channels.content.includes(snip),
          `${vendor} content leaked ${JSON.stringify(snip)}`,
        );
      }

      const minTools = exp.minTools ?? 0;
      assert(
        merged.channels.tools.length >= minTools,
        `${vendor} tools ${merged.channels.tools.length} < ${minTools}`,
      );
      if (exp.toolName && merged.channels.tools.length > 0) {
        assert(
          merged.channels.tools[0].name === exp.toolName,
          `${vendor} tool name got ${merged.channels.tools[0].name}`,
        );
      }
      if (exp.finishReason) {
        assert(
          merged.endMeta.finishReason === exp.finishReason,
          `${vendor} finishReason got ${merged.endMeta.finishReason}`,
        );
      }
      assert(conversationHasContent(merged), `${vendor} conversationHasContent`);
    });
  }
});
