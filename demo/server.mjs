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

    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      const payload = JSON.stringify({ index: i, token: `word-${i}` });
      res.write(`data: ${payload}\n\n`);
      if (i >= 5) {
        res.write("data: [DONE]\n\n");
        clearInterval(timer);
        res.end();
      }
    }, 200);

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
