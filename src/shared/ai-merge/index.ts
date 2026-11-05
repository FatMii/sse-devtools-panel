import type { SseEvent } from "../types";
import type { AiConversation } from "./types";
import { ConversationMergeSession } from "./session";

export type { AiConversation } from "./types";

export {
  ConversationMergeSession,
  getConversationMergeSession,
  discardConversationMergeSession,
  clearConversationMergeSessions,
  overrideConversationProfile,
  syncConversationMergeSession,
} from "./session";
export { MERGEABLE_AI_PROFILES } from "../ai-profile";
export type { MergeableAiProfile } from "../ai-profile";

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
