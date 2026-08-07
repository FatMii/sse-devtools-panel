import type { AiProfile, AiProfileResult, AiVendorHint } from "../ai-profile";

export interface AiToolCall {
  index: number;
  id?: string;
  name?: string;
  arguments: string;
}

export interface AiConversationChannels {
  content: string;
  reasoning: string;
  tools: AiToolCall[];
}

export interface AiEndMeta {
  finishReason?: string;
  usage?: Record<string, unknown>;
  model?: string;
}

export interface AiConversation {
  profile: AiProfile;
  vendorHint: AiVendorHint;
  detection: AiProfileResult;
  channels: AiConversationChannels;
  endMeta: AiEndMeta;
  /** Number of events that contributed a parseable AI chunk. */
  chunkCount: number;
}

export type MergeChannelsResult = {
  channels: AiConversationChannels;
  endMeta: AiEndMeta;
  chunkCount: number;
};
