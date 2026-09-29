import {
  createRequestId,
  streamRecordFromExport,
  type StreamExportBody,
} from "../../shared/stream-snapshot";
import type { StreamRecord } from "../../shared/types";

/** Compact OpenAI-compatible sample so Conversation has thinking + content. */
export function buildTourSampleRecord(): StreamRecord {
  const startedAt = Date.now() - 1800;
  const chunks = [
    {
      id: "chatcmpl-tour",
      object: "chat.completion.chunk",
      model: "tour-demo",
      choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
    },
    {
      choices: [
        { index: 0, delta: { reasoning_content: "Plan a short greeting." }, finish_reason: null },
      ],
    },
    {
      choices: [{ index: 0, delta: { content: "Hello from " }, finish_reason: null }],
    },
    {
      choices: [{ index: 0, delta: { content: "SSE DevTools Panel." }, finish_reason: null }],
    },
    {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 },
    },
  ];

  const events = chunks.map((payload, index) => {
    const data = JSON.stringify(payload);
    const receivedAt = startedAt + (index + 1) * 220;
    return {
      index,
      event: "message",
      data,
      receivedAt,
      raw: `data: ${data}\n\n`,
    };
  });
  events.push({
    index: events.length,
    event: "message",
    data: "[DONE]",
    receivedAt: startedAt + 1400,
    raw: "data: [DONE]\n\n",
  });

  const raw = events.map((ev) => ev.raw).join("");
  const body: StreamExportBody = {
    requestId: "tour-sample",
    url: "https://api.deepseek.com/v1/chat/completions",
    method: "POST",
    status: 200,
    statusText: "OK",
    contentType: "text/event-stream",
    requestHeaders: {
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    responseHeaders: {
      "content-type": "text/event-stream; charset=utf-8",
    },
    requestPayloadPreview:
      '{\n  "stream": true,\n  "messages": [{ "role": "user", "content": "hi" }]\n}',
    transport: "fetch",
    streamKind: "sse",
    startedAt,
    endedAt: startedAt + 1500,
    streamStatus: "done",
    closeReason: "complete",
    metrics: {
      ttftMs: 220,
      durationMs: 1500,
      avgGapMs: 220,
      eventsPerSec: 4,
    },
    raw,
    events,
  };

  return streamRecordFromExport(body, {
    requestId: createRequestId("tour"),
    origin: "imported",
  });
}
