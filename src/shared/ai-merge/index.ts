import type { SseEvent } from "../types";
import type { AiConversation } from "./types";
import { ConversationMergeSession } from "./session";

export type {
  AiToolCall,
  AiConversationChannels,
  AiEndMeta,
  AiConversation,
  MergeChannelsResult,
} from "./types";

export type { OpenAiCompatibleMergeState } from "./openai";
export {
  createOpenAiCompatibleMergeState,
  pushOpenAiCompatible,
  snapshotOpenAiCompatible,
  mergeOpenAiCompatible,
} from "./openai";

export type { DeepseekWebMergeState, FragType } from "./deepseek";
export {
  createDeepseekWebMergeState,
  pushDeepseekWeb,
  snapshotDeepseekWeb,
  mergeDeepseekWeb,
} from "./deepseek";

export type { DoubaoWebMergeState } from "./doubao";
export {
  createDoubaoWebMergeState,
  pushDoubaoWeb,
  snapshotDoubaoWeb,
  mergeDoubaoWeb,
} from "./doubao";

export type { KimiWebMergeState } from "./kimi";
export {
  createKimiWebMergeState,
  pushKimiWeb,
  snapshotKimiWeb,
  mergeKimiWeb,
  sanitizeKimiAnswerText,
} from "./kimi";

export type { QwenWebMergeState } from "./qwen";
export {
  collapseCumulativeLines,
  createQwenWebMergeState,
  pushQwenWeb,
  snapshotQwenWeb,
  mergeQwenWeb,
} from "./qwen";

export type { ChatglmWebMergeState } from "./chatglm";
export {
  createChatglmWebMergeState,
  pushChatglmWeb,
  snapshotChatglmWeb,
  mergeChatglmWeb,
} from "./chatglm";

export type { YuanbaoWebMergeState } from "./yuanbao";
export {
  createYuanbaoWebMergeState,
  pushYuanbaoWeb,
  snapshotYuanbaoWeb,
  mergeYuanbaoWeb,
} from "./yuanbao";

export type { AcpMergeState } from "./acp";
export { createAcpMergeState, pushAcp, snapshotAcp, mergeAcp, extractAcpText } from "./acp";

export {
  ConversationMergeSession,
  getConversationMergeSession,
  discardConversationMergeSession,
  clearConversationMergeSessions,
  syncConversationMergeSession,
} from "./session";

/**
 * Merge stream events into an AI conversation (one-shot via incremental session).
 */
export function mergeAiConversation(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
  url?: string,
): AiConversation {
  const session = new ConversationMergeSession();
  session.push(events, url);
  return session.snapshot();
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
