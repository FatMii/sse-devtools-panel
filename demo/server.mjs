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
 * @param {import('node:http').ServerResponse} res
 * @param {number} count
 * @param {number} intervalMs
 */
function writeSseStream(res, count, intervalMs) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  let i = 0;
  let closed = false;
  const onClose = () => {
    closed = true;
  };
  res.req.on("close", onClose);

  const writeOne = () => {
    if (closed) return;
    if (i >= count) {
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
      res.end();
      return;
    }

    const content =
      count <= DEFAULT_CHUNKS.length
        ? DEFAULT_CHUNKS[i]
        : `token-${i + 1}/${count} ${DEFAULT_CHUNKS[i % DEFAULT_CHUNKS.length]}`;
    const payload = JSON.stringify({
      id: "chatcmpl-demo",
      object: "chat.completion.chunk",
      model: "demo-assistant-v1",
      choices: [{ index: 0, delta: { content } }],
    });
    res.write(`data: ${payload}\n\n`);
    i += 1;

    if (intervalMs <= 0) {
      // Batch a bit so the event loop / client can breathe on 10k streams.
      if (i % 50 === 0) setImmediate(writeOne);
      else writeOne();
    } else {
      setTimeout(writeOne, intervalMs);
    }
  };

  writeOne();
}

const DEMO_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SSE DevTools · Demo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
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
      font-family: Syne, sans-serif;
      font-weight: 800;
      font-size: clamp(2.6rem, 8vw, 4.6rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
      margin: 0;
      max-width: 12ch;
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

    #go {
      background: var(--signal);
      color: #f4fffb;
    }

    #go:hover:not(:disabled) {
      background: var(--signal-deep);
      transform: translateY(-1px);
    }

    #go10k {
      background: transparent;
      color: var(--ink-soft);
      border-color: rgba(16, 34, 31, 0.22);
    }

    #go10k:hover:not(:disabled) {
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
    <p class="lead">Local stream playground. Load the extension, open this page in DevTools, then fire a short or 10k event stream.</p>
    <div class="actions">
      <button id="go" type="button">Start stream</button>
      <button id="go10k" type="button">Start 10k stream</button>
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
    const buttons = [document.getElementById("go"), document.getElementById("go10k")];

    function setBusy(busy) {
      for (const btn of buttons) btn.disabled = busy;
      status.classList.toggle("is-live", busy);
    }

    async function runStream(path) {
      out.textContent = "";
      setBusy(true);
      statusText.textContent = "Streaming…";
      let n = 0;
      try {
        const res = await fetch(path);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          n += (text.match(/^data:/gm) || []).length;
          statusText.textContent = "Streaming · events≈" + n;
          // Avoid freezing the page UI when dumping 10k frames into <pre>.
          if (n <= 40 || n % 500 === 0) {
            out.textContent = "events≈" + n + "\\n" + text.slice(0, 400);
          }
        }
        out.textContent += "\\n--- done, events≈" + n + " ---";
        statusText.textContent = "Done · events≈" + n;
      } catch (err) {
        out.textContent = String(err && err.message ? err.message : err);
        statusText.textContent = "Failed";
      } finally {
        setBusy(false);
      }
    }

    document.getElementById("go").onclick = () => runStream("/api/stream");
    document.getElementById("go10k").onclick = () => runStream("/api/stream?count=10000");
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

  if (url.pathname === "/api/stream") {
    const countRaw = Number(url.searchParams.get("count") || DEFAULT_CHUNKS.length);
    const count = Number.isFinite(countRaw)
      ? Math.min(Math.max(1, Math.floor(countRaw)), 50_000)
      : DEFAULT_CHUNKS.length;
    // Short demo keeps the original cadence; bulk mode is as fast as practical.
    const intervalMs = count > DEFAULT_CHUNKS.length ? 0 : 220;
    writeSseStream(res, count, intervalMs);
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
  console.log(`  short:  http://127.0.0.1:${PORT}/api/stream`);
  console.log(`  10k:    http://127.0.0.1:${PORT}/api/stream?count=10000`);
});
