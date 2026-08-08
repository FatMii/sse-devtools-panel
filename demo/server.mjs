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

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8" /><title>SSE Demo</title></head>
<body>
  <h1>SSE Demo</h1>
  <p>
    <button id="go">Start stream</button>
    <button id="go10k">Start 10k stream</button>
  </p>
  <pre id="out"></pre>
  <script>
    async function runStream(path) {
      const out = document.getElementById('out');
      out.textContent = '';
      const res = await fetch(path);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let n = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        n += (text.match(/^data:/gm) || []).length;
        // Avoid freezing the page UI when dumping 10k frames into <pre>.
        if (n <= 40 || n % 500 === 0) {
          out.textContent = 'events≈' + n + '\\n' + text.slice(0, 400);
        }
      }
      out.textContent += '\\n--- done, events≈' + n + ' ---';
    }
    document.getElementById('go').onclick = () => runStream('/api/stream');
    document.getElementById('go10k').onclick = () => runStream('/api/stream?count=10000');
  </script>
</body>
</html>`);
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
