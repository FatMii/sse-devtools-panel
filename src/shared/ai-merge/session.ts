import type { SseEvent } from "../types";
import { detectAiProfile, type AiProfile, type AiProfileResult } from "../ai-profile";
import type { AiConversation, MergeChannelsResult } from "./types";
import {
  createOpenAiCompatibleMergeState,
  pushOpenAiCompatible,
  snapshotOpenAiCompatible,
  type OpenAiCompatibleMergeState,
} from "./openai";
import {
  createDeepseekWebMergeState,
  pushDeepseekWeb,
  snapshotDeepseekWeb,
  type DeepseekWebMergeState,
} from "./deepseek";
import {
  createDoubaoWebMergeState,
  pushDoubaoWeb,
  snapshotDoubaoWeb,
  type DoubaoWebMergeState,
} from "./doubao";
import {
  createKimiWebMergeState,
  pushKimiWeb,
  snapshotKimiWeb,
  type KimiWebMergeState,
} from "./kimi";
import {
  createQwenWebMergeState,
  pushQwenWeb,
  snapshotQwenWeb,
  type QwenWebMergeState,
} from "./qwen";
import {
  createChatglmWebMergeState,
  pushChatglmWeb,
  snapshotChatglmWeb,
  type ChatglmWebMergeState,
} from "./chatglm";
import {
  createYuanbaoWebMergeState,
  pushYuanbaoWeb,
  snapshotYuanbaoWeb,
  type YuanbaoWebMergeState,
} from "./yuanbao";

type EventLike = Pick<SseEvent, "data" | "event">;

type VendorState =
  | { profile: "openai-compatible"; state: OpenAiCompatibleMergeState }
  | { profile: "deepseek-web"; state: DeepseekWebMergeState }
  | { profile: "doubao-web"; state: DoubaoWebMergeState }
  | { profile: "kimi-web"; state: KimiWebMergeState }
  | { profile: "qwen-web"; state: QwenWebMergeState }
  | { profile: "chatglm-web"; state: ChatglmWebMergeState }
  | { profile: "yuanbao-web"; state: YuanbaoWebMergeState };

function emptyChannelsResult(): MergeChannelsResult {
  return {
    channels: { content: "", reasoning: "", tools: [] },
    endMeta: {},
    chunkCount: 0,
  };
}

function createVendor(profile: AiProfile): VendorState | null {
  switch (profile) {
    case "openai-compatible":
      return { profile, state: createOpenAiCompatibleMergeState() };
    case "deepseek-web":
      return { profile, state: createDeepseekWebMergeState() };
    case "doubao-web":
      return { profile, state: createDoubaoWebMergeState() };
    case "kimi-web":
      return { profile, state: createKimiWebMergeState() };
    case "qwen-web":
      return { profile, state: createQwenWebMergeState() };
    case "chatglm-web":
      return { profile, state: createChatglmWebMergeState() };
    case "yuanbao-web":
      return { profile, state: createYuanbaoWebMergeState() };
    default:
      return null;
  }
}

function pushVendor(vendor: VendorState, events: ReadonlyArray<EventLike>): void {
  switch (vendor.profile) {
    case "openai-compatible":
      pushOpenAiCompatible(vendor.state, events);
      break;
    case "deepseek-web":
      pushDeepseekWeb(vendor.state, events);
      break;
    case "doubao-web":
      pushDoubaoWeb(vendor.state, events);
      break;
    case "kimi-web":
      pushKimiWeb(vendor.state, events);
      break;
    case "qwen-web":
      pushQwenWeb(vendor.state, events);
      break;
    case "chatglm-web":
      pushChatglmWeb(vendor.state, events);
      break;
    case "yuanbao-web":
      pushYuanbaoWeb(vendor.state, events);
      break;
  }
}

function snapshotVendor(vendor: VendorState | null): MergeChannelsResult {
  if (!vendor) return emptyChannelsResult();
  switch (vendor.profile) {
    case "openai-compatible":
      return snapshotOpenAiCompatible(vendor.state);
    case "deepseek-web":
      return snapshotDeepseekWeb(vendor.state);
    case "doubao-web":
      return snapshotDoubaoWeb(vendor.state);
    case "kimi-web":
      return snapshotKimiWeb(vendor.state);
    case "qwen-web":
      return snapshotQwenWeb(vendor.state);
    case "chatglm-web":
      return snapshotChatglmWeb(vendor.state);
    case "yuanbao-web":
      return snapshotYuanbaoWeb(vendor.state);
  }
}

/**
 * Incremental conversation merge for one stream.
 * Only newly arrived events are parsed after the profile is locked.
 */
export class ConversationMergeSession {
  private offset = 0;
  private url: string | undefined;
  private detection: AiProfileResult | null = null;
  private profileLocked = false;
  private vendor: VendorState | null = null;

  reset(): void {
    this.offset = 0;
    this.detection = null;
    this.profileLocked = false;
    this.vendor = null;
  }

  /**
   * Advance merge with the full events array (session tracks how far it has consumed).
   */
  push(events: ReadonlyArray<EventLike>, url?: string): void {
    if (url !== undefined) this.url = url;

    if (this.offset > events.length) {
      this.reset();
    }

    if (!this.profileLocked) {
      this.detection = detectAiProfile(events, this.url);
      const profile = this.detection.profile;
      if (profile !== "generic" && profile !== "anthropic") {
        this.profileLocked = true;
        this.vendor = createVendor(profile);
        // Profile just resolved — process the whole stream so far.
        if (this.vendor) pushVendor(this.vendor, events);
        this.offset = events.length;
        return;
      }
      // Still generic: nothing to accumulate; mark consumed.
      this.offset = events.length;
      return;
    }

    if (this.offset >= events.length) return;
    const pending = events.slice(this.offset);
    if (this.vendor) pushVendor(this.vendor, pending);
    this.offset = events.length;
  }

  snapshot(): AiConversation {
    const detection =
      this.detection ??
      ({
        profile: "generic",
        vendorHint: "unknown",
        matched: false,
        reasoningFields: [],
      } satisfies AiProfileResult);

    const merged = snapshotVendor(this.vendor);
    return {
      profile: detection.profile,
      vendorHint: detection.vendorHint,
      detection,
      channels: merged.channels,
      endMeta: merged.endMeta,
      chunkCount: merged.chunkCount,
    };
  }

  /** Events already consumed by this session. */
  get consumedCount(): number {
    return this.offset;
  }
}

const sessions = new Map<string, ConversationMergeSession>();

export function getConversationMergeSession(requestId: string): ConversationMergeSession {
  let session = sessions.get(requestId);
  if (!session) {
    session = new ConversationMergeSession();
    sessions.set(requestId, session);
  }
  return session;
}

export function discardConversationMergeSession(requestId: string): void {
  sessions.delete(requestId);
}

export function clearConversationMergeSessions(): void {
  sessions.clear();
}

/** Ensure session is caught up with record.events and return a snapshot. */
export function syncConversationMergeSession(
  requestId: string,
  events: ReadonlyArray<EventLike>,
  url?: string,
): AiConversation {
  const session = getConversationMergeSession(requestId);
  session.push(events, url);
  return session.snapshot();
}
