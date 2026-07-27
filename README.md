# SSE DevTools

Chrome DevTools 面板，用于实时查看 `text/event-stream`（SSE）响应。不依赖 Network 的 Preview/Response（流式接口经常白屏）。

## 功能

- DevTools 独立 **SSE** 面板
- 捕获 `fetch` / `EventSource` / `XHR` 的 SSE / NDJSON 流
- `fetch` 流优先 tee 旁路读取，跟随页面增量消费
- 实时展示 Events / Raw
- Events 列表与 JSON 抽屉支持搜索过滤（含正则）
- `data` 为 JSON 时以可折叠树展示
- 一键复制 Raw / 单条 Data
- 国际化：中文 / English（选项页可选手动语言，或跟随浏览器；扩展商店名称仍跟随浏览器）

## 开发

```bash
pnpm i
pnpm build
# 或监听重建
pnpm dev
```

产物在 `dist/`。

## 安装

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本仓库的 `dist` 目录
4. 打开目标网页，按 F12，切换到 **SSE** 面板
5. **刷新页面**（注入脚本在 `document_start` 生效），再触发流式接口

## 原理

页面 MAIN world 在文档最早阶段劫持 `fetch` / `EventSource` / `XMLHttpRequest`：对 SSE / NDJSON 响应，优先用 `body.tee()` 旁路读取（页面继续消费另一支），必要时回退到 `clone()` 或实例级 `getReader` 观察；经 content script → service worker → DevTools panel 转发。页面原有消费不受影响。

## 本地 Demo

```bash
pnpm build
node demo/server.mjs
```

浏览器打开 `http://127.0.0.1:8765`，加载扩展并打开 DevTools → **SSE**，刷新页面后点 **Start stream**。
