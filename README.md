# EventStream Panel

[![CI](https://github.com/FatMii/eventstream-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/FatMii/eventstream-panel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**Chrome 里真正能看懂的 Event Stream 面板。**

调试 SSE / NDJSON 时，Network 的 Preview 经常白屏、等流结束才出内容，或者干脆什么都没有。  
EventStream Panel 在页面最早阶段旁路捕获流数据，塞进独立的 DevTools 面板——**边流边看**，不打断页面原有消费。

```bash
pnpm i && pnpm build
# chrome://extensions → 加载 dist/ → F12 → EventStream → 刷新页面
```

> `v0.1.0` · Manifest V3 · 本地加载 · 尚未上架 Chrome Web Store

---

## 为什么需要它

| Chrome Network | EventStream Panel |
| --- | --- |
| 流式接口 Preview 常白屏 | 实时拆成 Events，边收边渲染 |
| 结束后才能翻 Response | Timeline 看间隔、卡顿、重连 |
| 看不到 chunk 节奏 | Stats：TTFT / gap / events·s |
| 只剩一坨 raw text | JSON 树、Spec 告警、异常扫描 |

适合：AI 对话流、通知推送、进度上报、任何 `text/event-stream` / NDJSON 长连接。

---

## 能做什么

**捕获** — `fetch` · `EventSource` · `XHR`  
优先 `clone()` 旁路读取，失败再观察 `getReader`；记下 `abort` / `error` / 重连 / `Last-Event-ID`。

**四个 Tab**

- **Events** — 列表 + 可折叠 JSON 树 + 正则过滤 + 列宽拖拽
- **Timeline** — 到达瀑布、间隔直方图、≥250ms 卡顿高亮、重连菱形
- **Request** — 仿 Network：Headers / Payload（敏感头脱敏）
- **Raw** — 原文一键复制

**分析** — Pause UI（停绘不停抓）· Stats · Anomalies · SSE Spec 校验 · 跨 Stream 全局搜索  

**带走** — 导出 JSON / CSV / `.sse` Fixture · 导入回放 · IndexedDB Archives

中英界面；选项页可固定语言或跟随浏览器。

---

## 安装

```bash
git clone https://github.com/FatMii/eventstream-panel.git
cd eventstream-panel
pnpm i
pnpm build
```

1. 打开 `chrome://extensions`，打开「开发者模式」
2. 「加载已解压的扩展程序」→ 选仓库里的 **`dist`**
3. 打开目标站 → <kbd>F12</kbd> → **EventStream**
4. **刷新页面**（注入发生在 `document_start`），再打流式接口

改代码时用 `pnpm dev` 监听构建，扩展页点「重新加载」即可。

### 30 秒 Demo

```bash
pnpm build && pnpm demo
```

打开 <http://127.0.0.1:8765> → 加载扩展 → DevTools **EventStream** → 刷新 → **Start stream**。

---

## 开发

```bash
pnpm build       # 类型检查 + 打包
pnpm dev         # watch
pnpm typecheck
pnpm test-only   # parser / export / spec / timing / request-view / close
```

更完整的协作说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)。公开仓库与分支保护步骤见 [docs/GITHUB_SETUP.md](./docs/GITHUB_SETUP.md)。

| | |
| --- | --- |
| `src/content/inject-main.ts` | MAIN world 劫持 |
| bridge content script | ISOLATED → 扩展 |
| service worker | 消息中继 |
| `src/panel/` | 面板 UI |
| `src/shared/` | 解析 · 时序 · Spec · 导出 |
| `_locales/` | i18n |

---

## 怎么工作的

```text
Page (MAIN)                 Extension                    DevTools
─────────────────────       ──────────────────           ─────────
patch fetch / ES / XHR
        │
   clone() + pump  ──postMessage──► bridge ──► SW ──► EventStream Panel
   (or observe getReader)              │
        │                              └─ 页面自己的 body 消费不受影响
        ▼
   页面继续读原 Response
```

---

## 限制

- 只面向 **Chromium** DevTools
- 抓不到页面 **Service Worker** 里发起的 fetch
- 更深的 Stream API hook（`pipeThrough` / `pipeTo` 等）还没做——有漏抓欢迎带复现开 Issue
- AI Transcript（多厂商合并视图）做过一版后回退了，之后会用真实抓包重做

---

## 贡献

Issue / PR 都欢迎，请先读 [CONTRIBUTING.md](./CONTRIBUTING.md)。发 PR 前请跑：

```bash
pnpm test-only && pnpm typecheck && pnpm build
```

写清：复现步骤、Chrome 版本、能不能用本地 Demo 打出来。

## License

[MIT](./LICENSE) © FatMii
