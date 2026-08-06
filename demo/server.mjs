import http from "node:http";

const PORT = 8765;

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8" /><title>SSE Demo</title></head>
<body>
  <h1>SSE Demo</h1>
  <button id="go">Start stream</button>
  <pre id="out"></pre>
  <script>
    document.getElementById('go').onclick = async () => {
      const out = document.getElementById('out');
      out.textContent = '';
      const res = await fetch('/api/stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out.textContent += decoder.decode(value, { stream: true });
      }
    };
  </script>
</body>
</html>`);
    return;
  }

  if (req.url === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const chunks = [
      "你好",
      "，欢迎来到",
      " EventStream Panel。",
      "这是一个",
      "用于调试",
      "SSE / NDJSON / Connect+JSON",
      "流式响应的",
      "Chrome DevTools",
      "扩展演示。",
      "很高兴见到你！",
    ];

    let i = 0;
    const timer = setInterval(() => {
      const content = chunks[i];
      i += 1;
      const payload = JSON.stringify({
        id: "chatcmpl-demo",
        object: "chat.completion.chunk",
        model: "demo-assistant-v1",
        choices: [{ index: 0, delta: { content } }],
      });
      res.write(`data: ${payload}\n\n`);
      if (i >= chunks.length) {
        const donePayload = JSON.stringify({
          id: "chatcmpl-demo",
          object: "chat.completion.chunk",
          model: "demo-assistant-v1",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 18, completion_tokens: 42, total_tokens: 60 },
        });
        res.write(`data: ${donePayload}\n\n`);
        const endPayload = JSON.stringify({
          id: "chatcmpl-demo",
          object: "chat.completion.chunk",
          model: "demo-assistant-v1",
          done: true,
        });
        res.write(`data: ${endPayload}\n\n`);
        clearInterval(timer);
        res.end();
      }
    }, 220);

    req.on("close", () => clearInterval(timer));
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
});
