import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mergeAiConversation } from "../index";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
const eventsPath = resolve(repoRoot, "fixtures/vendors/qwen/events.json");

type FixtureEvent = { data: string; event?: string };

describe("qwen weather dump", () => {
  it("merges bar/workflow thinking and weather tool from the qwen fixture", () => {
    expect(existsSync(eventsPath), `missing ${eventsPath}`).toBe(true);
    const events = JSON.parse(readFileSync(eventsPath, "utf8")) as FixtureEvent[];
    const merged = mergeAiConversation(
      events.map((e) => ({ data: e.data, event: e.event ?? "message" })),
      "https://www.qianwen.com/chat",
    );
    expect(merged.profile).toBe("qwen-web");
    expect(merged.channels.tools[0]?.name).toBe("web_search");
    const weather = merged.channels.tools.find((t) => t.id === "bar_tool_1");
    expect(weather?.name).toBe("weather");
    const args = JSON.parse(weather?.arguments ?? "{}") as { query?: string; body?: string };
    expect(args.query).toContain("weather");
    expect(args.body).toBeUndefined();
    expect(merged.channels.reasoning).toContain("Call the weather tool");
    expect(merged.channels.reasoning).toContain("Summarize the weather tool result");
    expect(merged.channels.content).toContain("today is partly cloudy");
  });
});
