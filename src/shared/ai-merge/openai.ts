import type { SseEvent } from "../types";
import { isOpenAiCompatibleChunk } from "../ai-profile";
import type { AiEndMeta, AiToolCall, MergeChannelsResult } from "./types";
import { asString, isRecord, parseEventData } from "./helpers";

export type OpenAiCompatibleMergeState = {
  content: string;
  reasoning: string;
  tools: Map<number, AiToolCall>;
  endMeta: AiEndMeta;
  chunkCount: number;
};

export function createOpenAiCompatibleMergeState(): OpenAiCompatibleMergeState {
  return {
    content: "",
    reasoning: "",
    tools: new Map(),
    endMeta: {},
    chunkCount: 0,
  };
}

export function pushOpenAiCompatible(
  state: OpenAiCompatibleMergeState,
  events: ReadonlyArray<Pick<SseEvent, "data">>,
): void {
  for (const ev of events) {
    const parsed = parseEventData(ev.data);
    if (parsed == null || !isOpenAiCompatibleChunk(parsed)) continue;
    state.chunkCount++;
    if (!isRecord(parsed)) continue;

    if (typeof parsed.model === "string" && !state.endMeta.model) {
      state.endMeta.model = parsed.model;
    }
    if (isRecord(parsed.usage)) {
      state.endMeta.usage = parsed.usage as Record<string, unknown>;
    }

    const choices = parsed.choices as unknown[];
    for (const choice of choices) {
      if (!isRecord(choice)) continue;
      const finish = asString(choice.finish_reason);
      if (finish) state.endMeta.finishReason = finish;

      const bag = isRecord(choice.delta)
        ? choice.delta
        : isRecord(choice.message)
          ? choice.message
          : null;
      if (!bag) continue;

      const c = asString(bag.content);
      if (c) state.content += c;

      const rc = asString(bag.reasoning_content) ?? asString(bag.reasoning);
      if (rc) state.reasoning += rc;

      const toolCalls = bag.tool_calls;
      if (!Array.isArray(toolCalls)) continue;
      for (const tc of toolCalls) {
        if (!isRecord(tc)) continue;
        const index = typeof tc.index === "number" ? tc.index : 0;
        let slot = state.tools.get(index);
        if (!slot) {
          slot = { index, arguments: "" };
          state.tools.set(index, slot);
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
}

export function snapshotOpenAiCompatible(state: OpenAiCompatibleMergeState): MergeChannelsResult {
  return {
    channels: {
      content: state.content,
      reasoning: state.reasoning,
      tools: Array.from(state.tools.values()).sort((a, b) => a.index - b.index),
    },
    endMeta: state.endMeta,
    chunkCount: state.chunkCount,
  };
}

export function mergeOpenAiCompatible(
  events: ReadonlyArray<Pick<SseEvent, "data">>,
): MergeChannelsResult {
  const s = createOpenAiCompatibleMergeState();
  pushOpenAiCompatible(s, events);
  return snapshotOpenAiCompatible(s);
}
