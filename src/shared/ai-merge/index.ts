import type { SseEvent } from "../types";
import { detectAiProfile } from "../ai-profile";
import type { AiEndMeta, AiConversation, AiConversationChannels } from "./types";
import { mergeOpenAiCompatible } from "./openai";
import { mergeDeepseekWeb } from "./deepseek";
import { mergeDoubaoWeb } from "./doubao";
import { mergeKimiWeb } from "./kimi";
import { mergeQwenWeb } from "./qwen";
import { mergeChatglmWeb } from "./chatglm";
import { mergeYuanbaoWeb } from "./yuanbao";

export type {
  AiToolCall,
  AiConversationChannels,
  AiEndMeta,
  AiConversation,
  MergeChannelsResult,
} from "./types";

/**
 * Merge stream events into an AI conversation.
 */
export function mergeAiConversation(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
  url?: string,
): AiConversation {
  const detection = detectAiProfile(events, url);
  let channels: AiConversationChannels = { content: "", reasoning: "", tools: [] };
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
  } else if (detection.profile === "qwen-web") {
    const merged = mergeQwenWeb(events);
    channels = merged.channels;
    endMeta = merged.endMeta;
    chunkCount = merged.chunkCount;
  } else if (detection.profile === "chatglm-web") {
    const merged = mergeChatglmWeb(events);
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

export function conversationHasContent(t: AiConversation): boolean {
  return (
    t.channels.content.length > 0 ||
    t.channels.reasoning.length > 0 ||
    t.channels.tools.length > 0 ||
    Boolean(t.endMeta.finishReason) ||
    Boolean(t.endMeta.usage)
  );
}
