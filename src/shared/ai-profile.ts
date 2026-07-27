import type { AiProfile, SseEvent } from "./types";

export interface AiProfileResult {
  profile: AiProfile;
  confidence: number;
  reasons: string[];
}

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

export function detectAiProfile(
  events: SseEvent[],
  context?: { url?: string; contentType?: string },
): AiProfileResult {
  const reasons: string[] = [];
  let openaiScore = 0;
  let anthropicScore = 0;
  let deepseekScore = 0;
  let doubaoScore = 0;

  const url = context?.url?.toLowerCase() ?? "";
  if (
    url.includes("/chat/completions") ||
    url.includes("/v1/responses") ||
    url.includes("api.openai.com")
  ) {
    openaiScore += 2;
    reasons.push("url hints OpenAI-compatible");
  }
  if (url.includes("/messages") || url.includes("anthropic") || url.includes("api.claude")) {
    anthropicScore += 2;
    reasons.push("url hints Anthropic");
  }
  if (url.includes("deepseek") || url.includes("/chat/completion")) {
    deepseekScore += 2;
    reasons.push("url hints DeepSeek-like");
  }
  if (
    url.includes("doubao") ||
    url.includes("volces.com") ||
    url.includes("volcengine") ||
    url.includes("/samantha/") ||
    url.includes("ark.cn-")
  ) {
    doubaoScore += 3;
    reasons.push("url hints Doubao / Volcengine");
  }

  for (const ev of events.slice(0, 80)) {
    const data = ev.data.trim();
    if (!data || data === "[DONE]") continue;
    const obj = asObject(safeParseJson(data));
    if (!obj) continue;

    if (ev.event === "message" && (typeof obj.v === "string" || asObject(obj.v))) {
      deepseekScore += 2;
    }
    if (ev.event === "update_session") {
      deepseekScore += 2;
    }
    if (typeof obj.o === "string" && (obj.o === "APPEND" || obj.o === "BATCH" || obj.o === "SET")) {
      deepseekScore += 1;
    }

    if (
      typeof obj.block_type === "number" ||
      typeof obj.content_type === "number" ||
      typeof obj.event_type === "number"
    ) {
      doubaoScore += 3;
    }
    if (typeof obj.patch_op === "string" || obj.patch_value != null) {
      doubaoScore += 1;
    }

    if (typeof obj.type === "string") {
      const type = obj.type;
      if (
        type === "message_start" ||
        type === "message_delta" ||
        type === "content_block_delta" ||
        type === "content_block_start" ||
        type === "message_stop"
      ) {
        anthropicScore += 3;
      }
    }

    if (Array.isArray(obj.choices)) {
      openaiScore += 3;
      const first = asObject(obj.choices[0]);
      if (first) {
        const delta = asObject(first.delta);
        if (delta && typeof delta.content === "string") {
          openaiScore += 2;
        }
        if (delta && typeof delta.reasoning_content === "string") {
          // Doubao OpenAI-compatible often uses reasoning_content
          doubaoScore += 1;
        }
        if (typeof first.finish_reason === "string") {
          openaiScore += 1;
        }
      }
    }

    if (typeof obj.object === "string") {
      const objectName = obj.object;
      if (objectName.includes("chat.completion")) {
        openaiScore += 2;
      }
    }

    const deltaObj = asObject(obj.delta);
    if (deltaObj && typeof deltaObj.text === "string") {
      anthropicScore += 2;
    }
  }

  const ranked = [
    { profile: "anthropic" as const, score: anthropicScore },
    { profile: "deepseek" as const, score: deepseekScore },
    { profile: "doubao" as const, score: doubaoScore },
    { profile: "openai-compatible" as const, score: openaiScore },
  ].sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const second = ranked[1];
  if (top.score >= 4 && top.score >= second.score + 1) {
    reasons.push(
      `${top.profile}=${top.score} (openai=${openaiScore}, anthropic=${anthropicScore}, deepseek=${deepseekScore}, doubao=${doubaoScore})`,
    );
    return { profile: top.profile, confidence: Math.min(1, top.score / 10), reasons };
  }

  reasons.push(
    `fallback generic (openai=${openaiScore}, anthropic=${anthropicScore}, deepseek=${deepseekScore}, doubao=${doubaoScore})`,
  );
  return { profile: "generic", confidence: 0.3, reasons };
}
