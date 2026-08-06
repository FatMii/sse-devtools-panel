import type { SseEvent } from "../types";
import { isOpenAiCompatibleChunk } from "../ai-profile";
import type { AiEndMeta, AiToolCall, MergeChannelsResult } from "./types";
import { asString, isRecord, parseEventData } from "./helpers";

export function mergeOpenAiCompatible(
  events: ReadonlyArray<Pick<SseEvent, "data">>,
): MergeChannelsResult {
  let content = "";
  let reasoning = "";
  const tools = new Map<number, AiToolCall>();
  const endMeta: AiEndMeta = {};
  let chunkCount = 0;

  for (const ev of events) {
    const parsed = parseEventData(ev.data);
    if (parsed == null || !isOpenAiCompatibleChunk(parsed)) continue;
    chunkCount++;
    if (!isRecord(parsed)) continue;

    if (typeof parsed.model === "string" && !endMeta.model) {
      endMeta.model = parsed.model;
    }
    if (isRecord(parsed.usage)) {
      endMeta.usage = parsed.usage as Record<string, unknown>;
    }

    const choices = parsed.choices as unknown[];
    for (const choice of choices) {
      if (!isRecord(choice)) continue;
      const finish = asString(choice.finish_reason);
      if (finish) endMeta.finishReason = finish;

      const bag = isRecord(choice.delta)
        ? choice.delta
        : isRecord(choice.message)
          ? choice.message
          : null;
      if (!bag) continue;

      const c = asString(bag.content);
      if (c) content += c;

      const rc = asString(bag.reasoning_content) ?? asString(bag.reasoning);
      if (rc) reasoning += rc;

      const toolCalls = bag.tool_calls;
      if (!Array.isArray(toolCalls)) continue;
      for (const tc of toolCalls) {
        if (!isRecord(tc)) continue;
        const index = typeof tc.index === "number" ? tc.index : 0;
        let slot = tools.get(index);
        if (!slot) {
          slot = { index, arguments: "" };
          tools.set(index, slot);
        }
        if (typeof tc.id === "string") slot.id = tc.id;
        const fn = isRecord(tc.function) ? tc.function : null;
        if (fn) {
          if (typeof fn.name === "string") {
            slot.name = (slot.name ?? "") + fn.name;
          }
          if (typeof fn.arguments === "string") {
            slot.arguments += fn.arguments;
          }
        }
      }
    }
  }

  return {
    channels: {
      content,
      reasoning,
      tools: Array.from(tools.values()).sort((a, b) => a.index - b.index),
    },
    endMeta,
    chunkCount,
  };
}
