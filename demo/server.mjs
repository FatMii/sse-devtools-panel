import http from "node:http";

const PORT = 8765;
const DEFAULT_CHUNKS = [
  "Hello",
  ", welcome to",
  " SSE DevTools Panel.",
  " This is a",
  " Chrome DevTools",
  " extension demo",
  " for debugging",
  " SSE / NDJSON / Connect+JSON",
  " streaming responses.",
  " Nice to meet you!",
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
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SSE DevTools · Demo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #f3f6fa;
      --surface: #ffffff;
      --surface-2: #f7f9fc;
      --line: #d7e0ea;
      --line-strong: #b8c7d8;
      --muted: #64748b;
      --text: #0f172a;
      --text-soft: #475569;
      --blue: #1d4ed8;
      --accent: #2563eb;
      --accent-soft: #e8f0ff;
      --shadow: rgba(15, 23, 42, 0.08);
      --shadow-strong: rgba(15, 23, 42, 0.14);
      --font-sans: "Plus Jakarta Sans", "Segoe UI", sans-serif;
      --font-mono: "IBM Plex Mono", Consolas, monospace;
      --ease: cubic-bezier(0.16, 1, 0.3, 1);
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      min-height: 100%;
    }

    body {
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.5;
      background:
        radial-gradient(ellipse 70% 40% at 50% -10%, rgba(37, 99, 235, 0.12), transparent 55%),
        var(--bg);
      overflow-x: hidden;
    }

    .shell {
      position: relative;
      z-index: 1;
      width: min(920px, calc(100% - 2.5rem));
      margin: 0 auto;
      padding: clamp(2.5rem, 8vh, 5.5rem) 0 3rem;
      display: grid;
      gap: 1.25rem;
    }

    .eyebrow {
      margin: 0;
      color: var(--blue);
      font: 600 12px/1.2 var(--font-mono);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      animation: rise 0.55s var(--ease) both;
    }

    .brand {
      margin: 0;
      font-size: clamp(2rem, 4.8vw, 3.25rem);
      font-weight: 800;
      line-height: 1.12;
      letter-spacing: -0.045em;
      max-width: 16ch;
      animation: rise 0.55s var(--ease) 0.06s both;
    }

    .brand span {
      color: var(--accent);
    }

    .lead {
      margin: 0;
      max-width: 40rem;
      color: var(--text-soft);
      font-size: 1.05rem;
      line-height: 1.6;
      animation: rise 0.55s var(--ease) 0.1s both;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 0.35rem;
      animation: rise 0.55s var(--ease) 0.14s both;
    }

    button {
      appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 0.7rem 1.1rem;
      background: var(--surface);
      color: var(--text);
      font: 600 0.9rem/1.2 var(--font-sans);
      cursor: pointer;
      box-shadow: 0 1px 2px var(--shadow);
      transition: transform 180ms var(--ease), background 180ms var(--ease), border-color 180ms var(--ease), box-shadow 180ms var(--ease);
    }

    button:disabled {
      opacity: 0.55;
      cursor: wait;
    }

    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
      box-shadow: 0 12px 28px rgba(37, 99, 235, 0.25);
    }

    button.primary:hover:not(:disabled) {
      background: var(--blue);
      transform: translateY(-1px);
    }

    button.ghost:hover:not(:disabled) {
      border-color: var(--accent);
      color: var(--blue);
      background: var(--accent-soft);
      transform: translateY(-1px);
    }

    .status {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      min-height: 1.25rem;
      color: var(--muted);
      font: 500 0.8rem/1.3 var(--font-mono);
      letter-spacing: 0.02em;
      animation: rise 0.55s var(--ease) 0.18s both;
    }

    .status .dot {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      background: var(--line-strong);
    }

    .status.is-live .dot {
      background: var(--accent);
      box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.45);
      animation: pulse 1.4s ease-out infinite;
    }

    .feed {
      margin: 0;
      min-height: min(42vh, 360px);
      max-height: min(52vh, 480px);
      overflow: auto;
      padding: 1.1rem 1.2rem;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--text);
      box-shadow: 0 8px 24px var(--shadow);
      font: 0.8rem/1.55 var(--font-mono);
      white-space: pre-wrap;
      word-break: break-word;
      animation: rise 0.55s var(--ease) 0.22s both;
    }

    .feed:empty::before {
      content: "Waiting for stream…\\AOpen F12 → SSE DevTools, refresh this page, then start a stream.";
      white-space: pre-wrap;
      color: var(--muted);
    }

    .hint {
      margin: 0;
      color: var(--muted);
      font-size: 0.8rem;
      line-height: 1.5;
      animation: rise 0.55s var(--ease) 0.26s both;
    }

    @keyframes rise {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: none; }
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.45); }
      70% { box-shadow: 0 0 0 10px rgba(37, 99, 235, 0); }
      100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
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
    <p class="eyebrow">Local playground</p>
    <h1 class="brand">SSE DevTools <span>Panel</span></h1>
    <p class="lead">Load the extension, open DevTools → SSE DevTools, refresh this page, then try each transport.</p>
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
