import http from "node:http";

const PORT = 8765;
const DEFAULT_CHUNKS = [
  "你好",
  "，欢迎来到",
  " SSE DevTools Panel。",
  "这是一个",
  "用于调试",
  "SSE / NDJSON / Connect+JSON",
  "流式响应的",
  "Chrome DevTools",
  "扩展演示。",
  "很高兴见到你！",
];

/**
 * @param {number} i
 * @param {number} count
 */
function demoChunkContent(i, count) {
  return count <= DEFAULT_CHUNKS.length
    ? DEFAULT_CHUNKS[i]
    : `token-${i + 1}/${count} ${DEFAULT_CHUNKS[i % DEFAULT_CHUNKS.length]}`;
}

/**
 * @param {number} i
 * @param {number} count
 */
function demoChatChunk(i, count) {
  return {
    id: "chatcmpl-demo",
    object: "chat.completion.chunk",
    model: "demo-assistant-v1",
    choices: [{ index: 0, delta: { content: demoChunkContent(i, count) } }],
  };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {() => void} writeFrame
 * @param {number} count
 * @param {number} intervalMs
 * @param {() => void} writeDone
 */
function runTimedStream(res, writeFrame, count, intervalMs, writeDone) {
  let i = 0;
  let closed = false;
  res.req.on("close", () => {
    closed = true;
  });

  const writeOne = () => {
    if (closed) return;
    if (i >= count) {
      writeDone();
      res.end();
      return;
    }
    writeFrame(i);
    i += 1;
    if (intervalMs <= 0) {
      if (i % 50 === 0) setImmediate(writeOne);
      else writeOne();
    } else {
      setTimeout(writeOne, intervalMs);
    }
  };

  writeOne();
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} count
 * @param {number} intervalMs
 */
/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} count
 * @param {number} intervalMs
 * @param {string} [contentType]
 */
function writeSseStream(res, count, intervalMs, contentType = "text/event-stream; charset=utf-8") {
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  runTimedStream(
    res,
    (i) => {
      res.write(`data: ${JSON.stringify(demoChatChunk(i, count))}\n\n`);
    },
    count,
    intervalMs,
    () => {
      const donePayload = JSON.stringify({
        id: "chatcmpl-demo",
        object: "chat.completion.chunk",
        model: "demo-assistant-v1",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 18, completion_tokens: count, total_tokens: 18 + count },
      });
      res.write(`data: ${donePayload}\n\n`);
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-demo",
          object: "chat.completion.chunk",
          model: "demo-assistant-v1",
          done: true,
        })}\n\n`,
      );
    },
  );
}

/**
 * SSE frames with a custom event type (`event: ping`) for EventSource `onping` tests.
 * @param {import('node:http').ServerResponse} res
 * @param {number} count
 * @param {number} intervalMs
 */
function writeSseCustomEventStream(res, count, intervalMs) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  runTimedStream(
    res,
    (i) => {
      res.write(`event: ping\ndata: ${JSON.stringify(demoChatChunk(i, count))}\n\n`);
    },
    count,
    intervalMs,
    () => {
      res.write(`event: ping\ndata: ${JSON.stringify({ done: true })}\n\n`);
    },
  );
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} count
 * @param {number} intervalMs
 */
function writeNdjsonStream(res, count, intervalMs) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  runTimedStream(
    res,
    (i) => {
      res.write(`${JSON.stringify(demoChatChunk(i, count))}\n`);
    },
    count,
    intervalMs,
    () => {
      res.write(
        `${JSON.stringify({
          id: "chatcmpl-demo",
          object: "chat.completion.chunk",
          model: "demo-assistant-v1",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n`,
      );
    },
  );
}

const DEMO_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SSE DevTools · Demo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #10221f;
      --ink-soft: #24363a;
      --paper: #eef3f0;
      --paper-2: #e2ebe6;
      --signal: #0b7f6b;
      --signal-deep: #065f51;
      --mute: #5c6f6a;
      --line: rgba(16, 34, 31, 0.12);
      --feed: #0d1716;
      --feed-text: #c8ddd6;
      --ease: cubic-bezier(0.22, 1, 0.36, 1);
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      min-height: 100%;
    }

    body {
      color: var(--ink);
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      background:
        radial-gradient(1200px 700px at 12% -10%, rgba(11, 127, 107, 0.18), transparent 55%),
        radial-gradient(900px 600px at 90% 10%, rgba(16, 34, 31, 0.08), transparent 50%),
        linear-gradient(165deg, #f7faf8 0%, var(--paper) 42%, var(--paper-2) 100%);
      overflow-x: hidden;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.45;
      background-image:
        linear-gradient(var(--line) 1px, transparent 1px),
        linear-gradient(90deg, var(--line) 1px, transparent 1px);
      background-size: 48px 48px;
      mask-image: radial-gradient(ellipse 80% 70% at 50% 30%, #000 20%, transparent 75%);
    }

    body::after {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: repeating-linear-gradient(
        -18deg,
        transparent 0 14px,
        rgba(11, 127, 107, 0.03) 14px 15px
      );
    }

    .shell {
      position: relative;
      z-index: 1;
      width: min(920px, calc(100% - 2.5rem));
      margin: 0 auto;
      padding: clamp(2.5rem, 8vh, 5.5rem) 0 3rem;
      display: grid;
      gap: 1.75rem;
    }

    .brand {
      font-family: "Bricolage Grotesque", sans-serif;
      font-optical-sizing: auto;
      font-weight: 700;
      font-size: clamp(2.75rem, 7.5vw, 4.35rem);
      line-height: 1.08;
      letter-spacing: -0.015em;
      margin: 0;
      max-width: 14ch;
      animation: rise 0.7s var(--ease) both;
    }

    .brand span {
      display: block;
      color: var(--signal-deep);
    }

    .lead {
      margin: 0;
      max-width: 36rem;
      color: var(--mute);
      font-size: 0.95rem;
      line-height: 1.55;
      animation: rise 0.7s var(--ease) 0.08s both;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      animation: rise 0.7s var(--ease) 0.16s both;
    }

    button {
      appearance: none;
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 0.85rem 1.15rem;
      font: inherit;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: transform 180ms var(--ease), background 180ms var(--ease), border-color 180ms var(--ease);
    }

    button:disabled {
      opacity: 0.55;
      cursor: wait;
    }

    button.primary {
      background: var(--signal);
      color: #f4fffb;
    }

    button.primary:hover:not(:disabled) {
      background: var(--signal-deep);
      transform: translateY(-1px);
    }

    button.ghost {
      background: transparent;
      color: var(--ink-soft);
      border-color: rgba(16, 34, 31, 0.22);
    }

    button.ghost:hover:not(:disabled) {
      border-color: var(--signal);
      color: var(--signal-deep);
      transform: translateY(-1px);
    }

    .status {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      min-height: 1.25rem;
      color: var(--mute);
      font-size: 0.8rem;
      letter-spacing: 0.02em;
      animation: rise 0.7s var(--ease) 0.22s both;
    }

    .status .dot {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      background: #9aaea8;
    }

    .status.is-live .dot {
      background: var(--signal);
      box-shadow: 0 0 0 0 rgba(11, 127, 107, 0.45);
      animation: pulse 1.4s ease-out infinite;
    }

    .feed {
      margin: 0;
      min-height: min(42vh, 360px);
      max-height: min(52vh, 480px);
      overflow: auto;
      padding: 1.1rem 1.2rem;
      border-radius: 6px;
      border: 1px solid rgba(13, 23, 22, 0.35);
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 28%),
        var(--feed);
      color: var(--feed-text);
      font-size: 0.8rem;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
      animation: rise 0.7s var(--ease) 0.28s both;
    }

    .feed:empty::before {
      content: "Waiting for stream…\\AOpen F12 → SSE DevTools, refresh this page, then start a stream.";
      white-space: pre-wrap;
      color: rgba(200, 221, 214, 0.45);
    }

    .hint {
      margin: 0;
      color: var(--mute);
      font-size: 0.75rem;
      line-height: 1.5;
      animation: rise 0.7s var(--ease) 0.34s both;
    }

    @keyframes rise {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: none; }
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(11, 127, 107, 0.45); }
      70% { box-shadow: 0 0 0 10px rgba(11, 127, 107, 0); }
      100% { box-shadow: 0 0 0 0 rgba(11, 127, 107, 0); }
    }

    @media (max-width: 560px) {
      .shell { width: min(100% - 1.5rem, 920px); }
      .actions { flex-direction: column; }
      button { width: 100%; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <h1 class="brand">SSE DevTools<span>Panel</span></h1>
    <p class="lead">Local stream playground. Load the extension, open DevTools → SSE DevTools, refresh this page, then try each transport.</p>
    <div class="actions">
      <button id="go-fetch" class="primary" type="button">Fetch SSE</button>
      <button id="go-es" class="ghost" type="button">EventSource</button>
      <button id="go-xhr" class="ghost" type="button">XHR SSE</button>
      <button id="go-ndjson" class="ghost" type="button">Fetch NDJSON</button>
      <button id="go-json-ct" class="ghost" type="button">Fetch SSE (JSON CT)</button>
      <button id="go-es-on" class="ghost" type="button">EventSource onping</button>
      <button id="go10k" class="ghost" type="button">Fetch SSE 10k</button>
    </div>
    <div class="status" id="status" aria-live="polite">
      <span class="dot" aria-hidden="true"></span>
      <span id="statusText">Idle</span>
    </div>
    <pre class="feed" id="out"></pre>
    <p class="hint">Tip: keep the SSE DevTools panel open before starting. Refresh if the extension loaded after this tab.</p>
  </main>
  <script>
    const out = document.getElementById("out");
    const status = document.getElementById("status");
    const statusText = document.getElementById("statusText");
    const buttons = Array.from(document.querySelectorAll(".actions button"));
    let activeEs = null;

    function setBusy(busy) {
      for (const btn of buttons) btn.disabled = busy;
      status.classList.toggle("is-live", busy);
    }

    function note(text) {
      out.textContent = text;
    }

    async function runFetchStream(path, label, init) {
      if (activeEs) { activeEs.close(); activeEs = null; }
      out.textContent = "";
      setBusy(true);
      statusText.textContent = label + " · streaming…";
      let n = 0;
      try {
        const res = await fetch(path, init);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          n += (text.match(/^data:/gm) || text.match(/\\n/g) || []).length;
          statusText.textContent = label + " · chunks≈" + n;
          if (n <= 40 || n % 500 === 0) {
            note(label + " · chunks≈" + n + "\\n" + text.slice(0, 400));
          }
        }
        note((out.textContent || "") + "\\n--- done ---");
        statusText.textContent = label + " · done";
      } catch (err) {
        note(String(err && err.message ? err.message : err));
        statusText.textContent = label + " · failed";
      } finally {
        setBusy(false);
      }
    }

    function runEventSource(path, useOnping) {
      if (activeEs) { activeEs.close(); activeEs = null; }
      out.textContent = "";
      setBusy(true);
      const label = useOnping ? "EventSource onping" : "EventSource";
      statusText.textContent = label + " · streaming…";
      let n = 0;
      const es = new EventSource(path);
      activeEs = es;
      const onEv = (ev) => {
        n += 1;
        statusText.textContent = label + " · events=" + n;
        if (n <= 40 || n % 100 === 0) {
          note(label + " · type=" + ev.type + " · events=" + n + "\\n" + String(ev.data).slice(0, 400));
        }
      };
      if (useOnping) es.onping = onEv;
      else es.onmessage = onEv;
      es.onerror = () => {
        es.close();
        if (activeEs === es) activeEs = null;
        note((out.textContent || "") + "\\n--- EventSource closed ---");
        statusText.textContent = label + " · done/closed · events=" + n;
        setBusy(false);
      };
    }

    function runXhr(path) {
      if (activeEs) { activeEs.close(); activeEs = null; }
      out.textContent = "";
      setBusy(true);
      statusText.textContent = "XHR · streaming…";
      const xhr = new XMLHttpRequest();
      let lastLen = 0;
      let n = 0;
      xhr.open("GET", path);
      xhr.onprogress = () => {
        const chunk = xhr.responseText.slice(lastLen);
        lastLen = xhr.responseText.length;
        n += (chunk.match(/^data:/gm) || []).length;
        statusText.textContent = "XHR · events≈" + n;
        if (n <= 40 || n % 100 === 0) {
          note("XHR · events≈" + n + "\\n" + chunk.slice(0, 400));
        }
      };
      xhr.onload = () => {
        note((out.textContent || "") + "\\n--- XHR done ---");
        statusText.textContent = "XHR · done · events≈" + n;
        setBusy(false);
      };
      xhr.onerror = () => {
        note("XHR failed");
        statusText.textContent = "XHR · failed";
        setBusy(false);
      };
      xhr.send();
    }

    document.getElementById("go-fetch").onclick = () => runFetchStream("/api/stream", "Fetch SSE");
    document.getElementById("go-es").onclick = () => runEventSource("/api/stream", false);
    document.getElementById("go-xhr").onclick = () => runXhr("/api/stream");
    document.getElementById("go-ndjson").onclick = () => runFetchStream("/api/ndjson", "Fetch NDJSON");
    document.getElementById("go-json-ct").onclick = () =>
      runFetchStream("/api/stream-json-ct", "Fetch SSE (JSON CT)", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream: true, model: "demo" }),
      });
    document.getElementById("go-es-on").onclick = () => runEventSource("/api/stream-custom", true);
    document.getElementById("go10k").onclick = () => runFetchStream("/api/stream?count=10000", "Fetch SSE 10k");
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DEMO_HTML);
    return;
  }

  if (
    url.pathname === "/api/stream" ||
    url.pathname === "/api/ndjson" ||
    url.pathname === "/api/stream-json-ct" ||
    url.pathname === "/api/stream-custom"
  ) {
    const countRaw = Number(url.searchParams.get("count") || DEFAULT_CHUNKS.length);
    const count = Number.isFinite(countRaw)
      ? Math.min(Math.max(1, Math.floor(countRaw)), 50_000)
      : DEFAULT_CHUNKS.length;
    // Short demo keeps the original cadence; bulk mode is as fast as practical.
    const intervalMs = count > DEFAULT_CHUNKS.length ? 0 : 220;
    if (url.pathname === "/api/ndjson") writeNdjsonStream(res, count, intervalMs);
    else if (url.pathname === "/api/stream-json-ct") {
      writeSseStream(res, count, intervalMs, "application/json; charset=utf-8");
    } else if (url.pathname === "/api/stream-custom") {
      writeSseCustomEventStream(res, count, intervalMs);
    } else writeSseStream(res, count, intervalMs);
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Kill it first, e.g.:`);
    console.error(`  netstat -ano | findstr :${PORT}`);
    console.error(`  taskkill /PID <pid> /F`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`SSE demo at http://127.0.0.1:${PORT}`);
  console.log(`  SSE:    http://127.0.0.1:${PORT}/api/stream`);
  console.log(`  NDJSON: http://127.0.0.1:${PORT}/api/ndjson`);
  console.log(`  10k:    http://127.0.0.1:${PORT}/api/stream?count=10000`);
});
