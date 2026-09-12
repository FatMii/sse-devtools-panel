import type { SseEvent } from "../types";
import { isAcpWireChunk } from "../ai-profile";
import type { AiEndMeta, AiToolCall, MergeChannelsResult } from "./types";
import { asString, isRecord, parseEventData } from "./helpers";

export type AcpToolPayload = {
  input?: unknown;
  status?: string;
  output?: unknown;
};

export type AcpMergeState = {
  content: string;
  /** Agent thought chunks only (plan is tracked separately). */
  reasoning: string;
  /** Latest rendered plan block (replaced on each plan snapshot). */
  planText: string;
  tools: Map<string, AiToolCall>;
  /** Parallel structured tool fields (merged into `arguments` on snapshot). */
  toolPayloads: Map<string, AcpToolPayload>;
  endMeta: AiEndMeta;
  chunkCount: number;
};

const CONTENT_KINDS = new Set(["agent_message_chunk", "agent_message"]);

const THOUGHT_KINDS = new Set(["agent_thought_chunk", "agent_thought"]);

const TOOL_KINDS = new Set(["tool_call", "tool_call_update"]);

const PLAN_KINDS = new Set(["plan", "plan_update"]);

export function createAcpMergeState(): AcpMergeState {
  return {
    content: "",
    reasoning: "",
    planText: "",
    tools: new Map(),
    toolPayloads: new Map(),
    endMeta: {},
    chunkCount: 0,
  };
}

/** Extract plain text from an ACP ContentBlock, block array, or string. */
export function extractAcpText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(extractAcpText).filter(Boolean).join("");
  }
  if (!isRecord(value)) return "";
  if (value.type === "text" && typeof value.text === "string") return value.text;
  // Some agents nest text under `content` on a block.
  if ("text" in value && typeof value.text === "string" && value.type == null) {
    return value.text;
  }
  return "";
}

function formatPlanEntries(entries: unknown): string {
  if (!Array.isArray(entries) || entries.length === 0) return "";
  const lines: string[] = ["[plan]"];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const content = asString(entry.content) ?? "";
    if (!content) continue;
    const status = asString(entry.status);
    const priority = asString(entry.priority);
    const bits = [status, priority].filter(Boolean).join("/");
    lines.push(bits ? `- [${bits}] ${content}` : `- ${content}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

/** Render plan / plan_update into a Thinking-friendly text block. */
export function formatAcpPlan(update: Record<string, unknown>): string {
  const kind = asString(update.sessionUpdate);
  if (kind === "plan") {
    return formatPlanEntries(update.entries);
  }
  if (kind === "plan_update" && isRecord(update.plan)) {
    const plan = update.plan;
    const id = asString(plan.planId);
    const body = formatPlanEntries(plan.entries);
    if (!body) return "";
    return id ? body.replace("[plan]", `[plan ${id}]`) : body;
  }
  return "";
}

function collectUpdates(parsed: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  const pushUpdate = (u: unknown) => {
    if (isRecord(u) && typeof u.sessionUpdate === "string") out.push(u);
  };

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!isRecord(item)) continue;
      // JSON-RPC batch: { jsonrpc, method: "session/update", params: { update } }
      if (item.method === "session/update" && isRecord(item.params)) {
        pushUpdate(item.params.update);
        continue;
      }
      pushUpdate(item);
    }
    return out;
  }

  if (!isRecord(parsed)) return out;

  // Session snapshot frame: { sessionId, version, updates: [...] }
  if (Array.isArray(parsed.updates)) {
    for (const u of parsed.updates) pushUpdate(u);
    return out;
  }

  // Single JSON-RPC notification
  if (parsed.method === "session/update" && isRecord(parsed.params)) {
    pushUpdate(parsed.params.update);
    return out;
  }

  // Bare session update object
  pushUpdate(parsed);
  return out;
}

function syncToolArguments(state: AcpMergeState, id: string): void {
  const slot = state.tools.get(id);
  const payload = state.toolPayloads.get(id);
  if (!slot || !payload) return;
  const hasExtra =
    payload.status !== undefined || payload.output !== undefined || payload.input !== undefined;
  if (!hasExtra) {
    slot.arguments = "";
    return;
  }
  // Prefer a stable JSON object so Tools cards show status/output, not only rawInput.
  slot.arguments = JSON.stringify(payload);
}

function applyUpdate(state: AcpMergeState, update: Record<string, unknown>): void {
  const kind = asString(update.sessionUpdate);
  if (!kind) return;

  // Ignore control / meta surfaces — Conversation is chat-facing only.
  if (kind.startsWith("_drive/")) return;
  if (
    kind === "session_info_update" ||
    kind === "available_commands_update" ||
    kind === "config_option_update" ||
    kind === "current_mode_update" ||
    kind === "user_message_chunk" ||
    kind === "user_message" ||
    kind === "plan_removed"
  ) {
    if (kind === "plan_removed") state.planText = "";
    return;
  }

  if (kind === "state_update") {
    const stop = asString(update.stopReason);
    const stateName = asString(update.state);
    // Turn finished: idle + stopReason is the canonical ACP end signal on this wire.
    if (stateName === "idle" && stop) {
      state.endMeta.finishReason = stop;
      state.chunkCount++;
    }
    return;
  }

  if (kind === "usage_update") {
    const usage: Record<string, unknown> = {};
    if (typeof update.used === "number") usage.used = update.used;
    if (typeof update.size === "number") usage.size = update.size;
    if (update.cost !== undefined) usage.cost = update.cost;
    if (Object.keys(usage).length > 0) {
      state.endMeta.usage = usage;
      state.chunkCount++;
    }
    return;
  }

  if (PLAN_KINDS.has(kind)) {
    const rendered = formatAcpPlan(update);
    if (rendered) {
      state.planText = rendered;
      state.chunkCount++;
    }
    return;
  }

  if (CONTENT_KINDS.has(kind)) {
    const text = extractAcpText(update.content);
    if (text) {
      state.content += text;
      state.chunkCount++;
    }
    return;
  }

  if (THOUGHT_KINDS.has(kind)) {
    const text = extractAcpText(update.content);
    if (text) {
      state.reasoning += text;
      state.chunkCount++;
    }
    return;
  }

  if (TOOL_KINDS.has(kind)) {
    const id = asString(update.toolCallId) ?? `tool-${state.tools.size}`;
    let slot = state.tools.get(id);
    if (!slot) {
      slot = { index: state.tools.size, id, arguments: "" };
      state.tools.set(id, slot);
    }
    let payload = state.toolPayloads.get(id);
    if (!payload) {
      payload = {};
      state.toolPayloads.set(id, payload);
    }

    const name = asString(update.title) ?? asString(update.name);
    if (name) slot.name = name;
    if (update.rawInput !== undefined) payload.input = update.rawInput;
    const status = asString(update.status);
    if (status) payload.status = status;
    if (update.rawOutput !== undefined) payload.output = update.rawOutput;

    syncToolArguments(state, id);
    state.chunkCount++;
  }
}

export function pushAcp(
  state: AcpMergeState,
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): void {
  for (const ev of events) {
    // Control frames carry no conversation payload.
    if (ev.event === "stream-alive" || ev.event === "taken-over") continue;

    const parsed = parseEventData(ev.data);
    if (parsed == null) continue;
    if (!isAcpWireChunk(parsed, ev.event)) continue;

    for (const update of collectUpdates(parsed)) {
      applyUpdate(state, update);
    }
  }
}

function combinedReasoning(state: AcpMergeState): string {
  if (state.reasoning && state.planText) return `${state.reasoning}\n\n${state.planText}`;
  return state.reasoning || state.planText;
}

export function snapshotAcp(state: AcpMergeState): MergeChannelsResult {
  return {
    channels: {
      content: state.content,
      reasoning: combinedReasoning(state),
      tools: Array.from(state.tools.values()).sort((a, b) => a.index - b.index),
    },
    endMeta: state.endMeta,
    chunkCount: state.chunkCount,
  };
}

export function mergeAcp(
  events: ReadonlyArray<Pick<SseEvent, "data" | "event">>,
): MergeChannelsResult {
  const s = createAcpMergeState();
  pushAcp(s, events);
  return snapshotAcp(s);
}
