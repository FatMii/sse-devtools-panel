import type { AiProfile, SseEvent } from "./types";

function safeParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Extract OpenAI-style delta content from a parsed object. */
function extractOpenAiFragments(obj: Record<string, unknown>): string[] {
  const out: string[] = [];
  const choices = Array.isArray(obj.choices) ? obj.choices : [];
  for (const choice of choices) {
    const choiceObj = asObject(choice);
    if (!choiceObj) continue;
    const delta = asObject(choiceObj.delta);
    if (!delta) continue;
    const content = asString(delta.content);
    if (content != null) out.push(content);
    // Keep reasoning_content out of main transcript for now (channels later).
    if (Array.isArray(delta.content)) {
      for (const part of delta.content) {
        const partObj = asObject(part);
        if (partObj && typeof partObj.text === "string") {
          out.push(partObj.text);
        }
      }
    }
  }
  return out;
}

function extractTextFragment(obj: Record<string, unknown>): string | null {
  const direct = asString(obj.v);
  if (direct != null) return direct;

  const vObj = asObject(obj.v);
  if (vObj) {
    const fromV =
      asString(vObj.content) ??
      asString(vObj.text) ??
      asString(vObj.delta) ??
      asString(asObject(vObj.message)?.content);
    if (fromV != null) return fromV;
  }

  const message = asObject(obj.message);
  if (message) {
    const fromMessage = asString(message.content) ?? asString(message.text);
    if (fromMessage != null) return fromMessage;
  }

  return asString(obj.content) ?? asString(obj.text);
}

function collectPatchFragments(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (value) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPatchFragments(item, out);
    return;
  }
  const obj = asObject(value);
  if (!obj) return;

  const op = typeof obj.o === "string" ? obj.o.toLowerCase() : "";
  if (op === "batch" && obj.v != null) {
    collectPatchFragments(obj.v, out);
    return;
  }

  const fragment = extractTextFragment(obj);
  if (fragment != null) {
    out.push(fragment);
    return;
  }

  if (obj.v != null) collectPatchFragments(obj.v, out);
}

function extractDeepSeekFragments(ev: SseEvent, obj: Record<string, unknown>): string[] {
  const out: string[] = [];

  if (ev.event === "update_session") {
    const message = asObject(obj.message);
    if (message) {
      const role = asString(message.role)?.toUpperCase();
      const content = asString(message.content) ?? asString(message.text);
      if (content && (!role || role === "ASSISTANT" || role === "AI")) {
        out.push(content);
      }
    }
    const response = asObject(obj.response);
    const responseMessage = asObject(response?.message);
    const responseContent = asString(responseMessage?.content);
    if (responseContent) out.push(responseContent);
    // Session bootstrap already carries full text; avoid re-walking the same object.
    return out;
  }

  // Prefer explicit patch / v deltas for message events.
  if (typeof obj.v === "string" || asObject(obj.v) || typeof obj.o === "string") {
    collectPatchFragments(obj, out);
    return out;
  }

  const fragment = extractTextFragment(obj);
  if (fragment != null) out.push(fragment);
  return out;
}

/** Doubao web / Volcengine native SSE shapes + OpenAI-compatible gateway. */
function extractDoubaoFragments(obj: Record<string, unknown>): string[] {
  const openAi = extractOpenAiFragments(obj);
  if (openAi.length > 0) return openAi;

  const out: string[] = [];

  // Native content_type / block_type text carriers
  const blockType = typeof obj.block_type === "number" ? obj.block_type : null;
  const contentType = typeof obj.content_type === "number" ? obj.content_type : null;
  const content = asObject(obj.content) ?? (typeof obj.content === "string" ? null : null);

  if (typeof obj.content === "string" && obj.content) {
    // Prefer answer text blocks; still keep generic string content for completeness.
    if (
      contentType == null ||
      contentType === 10000 ||
      contentType === 2001 ||
      blockType === 10000
    ) {
      out.push(obj.content);
    }
  }

  if (content) {
    const text =
      asString(content.text) ??
      asString(content.content) ??
      asString(asObject(content.text_block)?.text) ??
      asString(asObject(content.answer)?.text);
    if (text) out.push(text);

    // Thinking text is skipped for main transcript (Phase 2 channel split later).
    // Still accept plain answer fields under nested structures.
    const patchValue = obj.patch_value ?? content.patch_value;
    if (typeof patchValue === "string" && patchValue) {
      out.push(patchValue);
    } else if (patchValue != null) {
      collectPatchFragments(patchValue, out);
    }
  }

  if (typeof obj.patch_value === "string" && obj.patch_value) {
    out.push(obj.patch_value);
  } else if (obj.patch_value != null) {
    collectPatchFragments(obj.patch_value, out);
  }

  // Fallback: common text fields
  const fallback = asString(obj.text) ?? asString(obj.delta);
  if (fallback) out.push(fallback);

  return out;
}

export function buildMergedTranscript(events: SseEvent[], profile: AiProfile): string {
  if (profile === "anthropic") return mergeAnthropic(events);
  if (profile === "openai-compatible") return mergeOpenAiCompatible(events);
  if (profile === "deepseek") return mergeDeepSeek(events);
  if (profile === "doubao") return mergeDoubao(events);
  return mergeGeneric(events);
}

function mergeOpenAiCompatible(events: SseEvent[]): string {
  const out: string[] = [];
  for (const ev of events) {
    const data = ev.data.trim();
    if (!data || data === "[DONE]") continue;
    const obj = asObject(safeParseJson(data));
    if (!obj) continue;
    out.push(...extractOpenAiFragments(obj));
  }
  return out.join("");
}

function mergeAnthropic(events: SseEvent[]): string {
  const out: string[] = [];
  for (const ev of events) {
    const obj = asObject(safeParseJson(ev.data));
    if (!obj) continue;
    const type = typeof obj.type === "string" ? obj.type : "";
    if (type === "content_block_delta") {
      const delta = asObject(obj.delta);
      if (delta && typeof delta.text === "string") {
        out.push(delta.text);
      }
    }
  }
  return out.join("");
}

function mergeDeepSeek(events: SseEvent[]): string {
  const out: string[] = [];
  for (const ev of events) {
    if (ev.event === "close") continue;
    const data = ev.data.trim();
    if (!data) continue;
    const obj = asObject(safeParseJson(data));
    if (!obj) continue;
    // Some DeepSeek gateways are OpenAI-compatible
    const openAi = extractOpenAiFragments(obj);
    if (openAi.length > 0) {
      out.push(...openAi);
      continue;
    }
    out.push(...extractDeepSeekFragments(ev, obj));
  }
  return out.join("");
}

function mergeDoubao(events: SseEvent[]): string {
  const out: string[] = [];
  for (const ev of events) {
    const data = ev.data.trim();
    if (!data || data === "[DONE]") continue;
    const obj = asObject(safeParseJson(data));
    if (!obj) continue;
    out.push(...extractDoubaoFragments(obj));
  }
  return out.join("");
}

function mergeGeneric(events: SseEvent[]): string {
  const out: string[] = [];
  for (const ev of events) {
    const data = ev.data.trim();
    if (!data || data === "[DONE]") continue;
    const obj = asObject(safeParseJson(data));
    if (!obj) {
      out.push(ev.data);
      continue;
    }
    const openAi = extractOpenAiFragments(obj);
    if (openAi.length > 0) {
      out.push(...openAi);
      continue;
    }
    const fragments = extractDeepSeekFragments(ev, obj);
    if (fragments.length > 0) {
      out.push(...fragments);
      continue;
    }
    const doubao = extractDoubaoFragments(obj);
    if (doubao.length > 0) {
      out.push(...doubao);
      continue;
    }
    const delta = asObject(obj.delta);
    if (delta && typeof delta.content === "string") {
      out.push(delta.content);
    } else if (delta && typeof delta.text === "string") {
      out.push(delta.text);
    }
  }
  return out.join("");
}
