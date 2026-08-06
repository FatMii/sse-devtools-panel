import type { SseEvent } from "../types";
import { detectAiProfile } from "../ai-profile";
import type { AiEndMeta, AiTranscript, AiTranscriptChannels } from "./types";
import { mergeOpenAiCompatible } from "./openai";
import { mergeDeepseekWeb } from "./deepseek";
import { mergeDoubaoWeb } from "./doubao";
import { mergeKimiWeb } from "./kimi";
import { mergeQianwenWeb } from "./qianwen";
import { mergeZhipuWeb } from "./zhipu";
import { mergeYuanbaoWeb } from "./yuanbao";

export type {
  AiToolCall,
  AiTranscriptChannels,
  AiEndMeta,
  AiTranscript,
  MergeChannelsResult,
} from "./types";

/**
 * Merge stream events into an AI transcript.
 */
export function mergeAiTranscript(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
  url?: string,
): AiTranscript {
  const detection = detectAiProfile(events, url);
  let channels: AiTranscriptChannels = { content: "", reasoning: "", tools: [] };
  let endMeta: AiEndMeta = {};
  let chunkCount = 0;

  if (detection.profile === "openai-compatible") {
    const merged = mergeOpenAiCompatible(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  } else if (detection.profile === "deepseek-web") {
    const merged = mergeDeepseekWeb(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  } else if (detection.profile === "doubao-web") {
    const merged = mergeDoubaoWeb(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  } else if (detection.profile === "kimi-web") {
    const merged = mergeKimiWeb(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  } else if (detection.profile === "qianwen-web") {
    const merged = mergeQianwenWeb(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  } else if (detection.profile === "zhipu-web") {
    const merged = mergeZhipuWeb(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  } else if (detection.profile === "yuanbao-web") {
    const merged = mergeYuanbaoWeb(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  }

  return {
    profile: detection.profile,
    vendorHint: detection.vendorHint,
    detection,
    channels,
    endMeta,
    chunkCount,
  };
}

export function transcriptHasContent(t: AiTranscript): boolean {
  return (
    t.channels.content.length > 0 ||
    t.channels.reasoning.length > 0 ||
    t.channels.tools.length > 0 ||
    Boolean(t.endMeta.finishReason) ||
    Boolean(t.endMeta.usage)
  );
}
