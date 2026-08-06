<p align="center">
  <img src="assets/icons/icon-128.png" alt="EventStream Panel" width="96" height="96">
</p>

<h1 align="center">EventStream Panel</h1>

<p align="center">
  <strong>Chrome 里真正能看懂的 Event Stream 面板</strong><br/>
  旁路捕获 SSE / NDJSON / Connect+JSON —— 边流边看，不打断页面原有消费
</p>

<p align="center">
  <a href="https://github.com/FatMii/eventstream-panel/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/FatMii/eventstream-panel/actions/workflows/ci.yml/badge.svg"></a>
  &nbsp;
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  &nbsp;
  <a href="#"><img alt="Platform" src="https://img.shields.io/badge/Platform-Chromium%20DevTools-blue"></a>
  &nbsp;
  <a href="#"><img alt="Manifest" src="https://img.shields.io/badge/Manifest-V3-informational"></a>
</p>

<p align="center">
  <code>v0.1.0</code> · 本地加载 · 尚未上架 Chrome Web Store
</p>

---

<p align="center">
  <!-- SCREENSHOT: hero / panel overview -->
  <img width="1400" alt="面板总览（待补图）" src="docs/assets/screenshots/panel-overview.png">
</p>

> 📌 **截图占位** `docs/assets/screenshots/panel-overview.png`  
> 建议：整页面板（左侧 Streams 列表 + 右侧 Detail，能看到 Events / Transcript / Timeline 等 Tab）

---

# 目录

- [为什么需要它](#为什么需要它)
- [它是什么 / 不是什么](#它是什么--不是什么)
- [功能特性](#功能特性)
  - [捕获与旁路](#-捕获与旁路)
  - [Streams 侧栏](#-streams-侧栏)
  - [Events](#-events)
  - [Request](#-request)
  - [Transcript（AI 合并视图）](#-transcriptai-合并视图)
  - [Timeline](#-timeline)
  - [Raw](#-raw)
  - [分析与工具栏](#-分析与工具栏)
  - [导入 / 导出 / 归档](#-导入--导出--归档)
  - [国际化与设置](#-国际化与设置)
- [界面截图](#界面截图)
- [已支持的 AI Web 厂商](#已支持的-ai-web-厂商)
- [快速开始](#快速开始)
- [30 秒 Demo](#30-秒-demo)
- [开发](#开发)
- [怎么工作的](#怎么工作的)
- [限制](#限制)
- [参与贡献](#参与贡献)
- [开源协议](#开源协议)

---

<a name="为什么需要它"></a>

# 为什么需要它

Chrome Network 对**标准 SSE**已有请求详情里的 [EventStream](https://developer.chrome.com/docs/devtools/network/reference#analyze-events-in-a-stream) Tab（与 Headers / Response 同级），可以边流边看事件列表。

但对现在的 AI / 业务流往往不够用——它们很少是「原生 EventSource 教科书样例」：

- 多用 **`fetch` + 自定义 SSE / NDJSON / Connect+JSON**，Network 里经常只剩难读的 Response 碎片，或 EventStream Tab 空白 / 帮不上忙
- **看不到流内节奏**（TTFT、chunk gap、卡顿分布、重连标记）
- **AI 对话难读**：思考 / 正文 / 工具调用 / 搜索来源混在原始帧里，需要人工拼

| 场景                                          | Chrome Network             | EventStream Panel                         |
| --------------------------------------------- | -------------------------- | ----------------------------------------- |
| 标准 SSE（EventSource / 部分 fetch）          | 请求详情有 EventStream Tab | 同样可看，并带过滤、JSON 树、导出         |
| AI / 私有协议（NDJSON、Connect+JSON、厂商帧） | 多半是原文碎片，难拼成对话 | Profile 识别 + **Transcript** 分通道合并  |
| 流内时序与卡顿                                | 基本只有整请求耗时         | Timeline + Stats（TTFT / gap / events·s） |
| 规范与异常                                    | 无针对性扫描               | SSE Spec 告警 · Anomalies                 |
| 网页搜索等工具结果                            | 埋在 raw 里                | 归一成 `web_search` 卡片（查询 + 来源）   |

适合：**AI 对话流**、通知推送、进度上报，以及任何 `text/event-stream` / NDJSON / Connect+JSON 长连接。

---

<a name="它是什么--不是什么"></a>

# 它是什么 / 不是什么

**EventStream Panel 是**

- 独立的 Chromium **DevTools 面板**（F12 → EventStream）
- 页面最早阶段（`document_start`）注入的旁路捕获器
- 面向开发者的流式调试工作台：列表 · 时序 · 请求 · AI Transcript · 导出回放

**EventStream Panel 不是**

- Network 面板的替代品（Headers 全量审计仍以 Network 为准）
- 通用抓包工具 / MITM 代理
- 浏览器扩展商店里的「一键装好就能用」成品（当前需本地 `pnpm build` 加载 `dist`）

---

<a name="功能特性"></a>

# 功能特性

<a name="捕获与旁路"></a>

## 🎣 捕获与旁路

- **传输** — `fetch` · `EventSource` · `XHR`
- **格式** — SSE（`text/event-stream`）· NDJSON · Connect+JSON（如 Kimi）
- **旁路优先** — 优先 `Response.clone()` 泵数据，失败再观察 `getReader`；**不打断**页面自己的 body 消费
- **生命周期** — 记录 `abort` / `error` / 关闭原因 · EventSource 重连 · `Last-Event-ID`
- **延迟 announce** — 仅在响应 `Content-Type` 确认为流式后再登记，减少埋点 / 普通 JSON 误入列表

<a name="streams-侧栏"></a>

## 📚 Streams 侧栏

- 实时列出本页捕获到的流，显示方法、URL、状态、事件数
- **URL 过滤** + **传输类型**筛选（All / Fetch / EventSource / XHR）
- 无过滤时显示总数；有过滤时显示「可见 / 总数」
- **拖拽调宽**侧栏（约 180–640px）

<p align="center">
  <img width="480" alt="Streams 侧栏（待补图）" src="docs/assets/screenshots/streams-sidebar.png">
</p>

> 📌 占位：`docs/assets/screenshots/streams-sidebar.png`

<a name="events"></a>

## 📋 Events

流事件表：序号 · 到达时间 · event 名 · data 摘要。

- 行内展开 **可折叠 JSON 树**
- **正则 / 文本过滤**（带匹配提示）
- **列宽拖拽**
- 与 Timeline / Raw 联动定位（大间隔跳转等）

<p align="center">
  <img width="1200" alt="Events Tab（待补图）" src="docs/assets/screenshots/tab-events.png">
</p>

> 📌 占位：`docs/assets/screenshots/tab-events.png`

<a name="request"></a>

## 📨 Request

仿 Network 的请求侧视图：

- Headers / Payload
- 敏感头脱敏
- 与流元信息（method、URL、tags）同屏展示

<p align="center">
  <img width="1200" alt="Request Tab（待补图）" src="docs/assets/screenshots/tab-request.png">
</p>

> 📌 占位：`docs/assets/screenshots/tab-request.png`

<a name="transcriptai-合并视图"></a>

## 🧠 Transcript（AI 合并视图）

把「一坨 SSE」收成可读对话稿，按通道拆分：

| 通道       | 含义                                                     |
| ---------- | -------------------------------------------------------- |
| **正文**   | 最终回答                                                 |
| **思考**   | reasoning / think / deepSearch 等                        |
| **工具**   | 函数调用；网页搜索归一为 `web_search`（查询 + 来源卡片） |
| **元数据** | finishReason、usage、model、profile / vendor             |

- 自动 **Profile 识别**（按 payload 形状 + 主机提示）
- 工具卡：查询芯片 · 结果列表（标题 / URL / 摘要）；可折叠
- 国内主流 AI Web + OpenAI 兼容协议均可尝试合并（见下方[支持矩阵](#已支持的-ai-web-厂商)）

<p align="center">
  <img width="1200" alt="Transcript 正文 / 思考（待补图）" src="docs/assets/screenshots/tab-transcript-content.png">
</p>

> 📌 占位：`docs/assets/screenshots/tab-transcript-content.png`

<p align="center">
  <img width="1200" alt="Transcript 工具 · 网页搜索（待补图）" src="docs/assets/screenshots/tab-transcript-tools.png">
</p>

> 📌 占位：`docs/assets/screenshots/tab-transcript-tools.png`  
> 建议：展开后的「网页搜索」卡片（queries + 多条来源）

<a name="timeline"></a>

## ⏱ Timeline

- **到达瀑布**：每个 event 相对时间轴的位置
- **间隔直方图**：chunk gap 分布
- **≥250ms** 大间隔高亮，可跳回 Events 对应行
- **重连**标记（菱形等）

<p align="center">
  <img width="1200" alt="Timeline Tab（待补图）" src="docs/assets/screenshots/tab-timeline.png">
</p>

> 📌 占位：`docs/assets/screenshots/tab-timeline.png`

<a name="raw"></a>

## 📄 Raw

- 流原文（按解析后的事件拼回）
- **一键复制**，方便贴 Issue / 做 fixture

<a name="分析与工具栏"></a>

## 🛠 分析与工具栏

| 能力               | 说明                                                               |
| ------------------ | ------------------------------------------------------------------ |
| **暂停 / 继续 UI** | 停界面刷新，**不停捕获**；暂停时用 play 图标，继续后补刷列表与详情 |
| **Stats**          | TTFT、时长、平均 / 最大 gap、events·s 等                           |
| **Anomalies**      | 异常扫描（空 data、异常间隔等启发式）                              |
| **Spec**           | SSE 规范告警（字段 / 换行 / BOM 等）                               |
| **Search All**     | 跨 Stream 全局搜索                                                 |
| **Clear**          | 清空当前会话捕获                                                   |
| **Settings**       | 选项页入口（语言等）                                               |

<p align="center">
  <img width="1200" alt="Stats / Anomalies（待补图）" src="docs/assets/screenshots/dialog-stats.png">
</p>

> 📌 占位：`docs/assets/screenshots/dialog-stats.png`

<a name="导入--导出--归档"></a>

## 💾 导入 / 导出 / 归档

- **导出** — JSON（`sse-devtools-stream-v1`）· CSV · `.sse` Fixture（方便 Mock / 单测）
- **导入** — 回放本地 JSON，无需再打一次线上接口
- **Save / Archives** — IndexedDB 本地归档，之后再打开翻看

<a name="国际化与设置"></a>

## 🌐 国际化与设置

- 界面 **中文 / English**
- 选项页：跟随浏览器，或固定语言

---

<a name="界面截图"></a>

# 界面截图

## 主界面

围绕「多条流 + 单条深挖」设计：侧栏选流，右侧用 Tab 切换 Events / Request / Transcript / Timeline / Raw。

<p align="center">
  <img width="1400" alt="主界面（待补图）" src="docs/assets/screenshots/main-workbench.png">
</p>

> 📌 占位：`docs/assets/screenshots/main-workbench.png`

## 工具栏与更多菜单

导入、导出、归档、Stats、暂停 UI、清空；「更多」里放 Anomalies / Spec / 全局搜索 / 设置。

<p align="center">
  <img width="1000" alt="工具栏（待补图）" src="docs/assets/screenshots/toolbar.png">
</p>

> 📌 占位：`docs/assets/screenshots/toolbar.png`

## Demo 页联调

本地 Demo 一键打出 SSE，方便验证扩展是否注入成功。

<p align="center">
  <img width="1000" alt="Demo 页（待补图）" src="docs/assets/screenshots/demo-page.png">
</p>

> 📌 占位：`docs/assets/screenshots/demo-page.png`

---

<a name="已支持的-ai-web-厂商"></a>

# 已支持的 AI Web 厂商

Transcript 按协议 Profile 合并。下列为当前已接线的 Web / 兼容形态（有抓包回归测试的优先保证）：

| Profile             | 典型站点 / 形态      | 说明                                                 |
| ------------------- | -------------------- | ---------------------------------------------------- |
| `openai-compatible` | 各类 OpenAI 兼容 API | `delta.content` / `reasoning_content` / `tool_calls` |
| `deepseek-web`      | DeepSeek 网页        | JSON-patch 风格思考 + 正文；支持搜索工具             |
| `doubao-web`        | 豆包网页             | 思考与正文拆分；搜索结果去重                         |
| `kimi-web`          | Kimi（Connect+JSON） | think / text / search block                          |
| `qwen-web`          | 通义千问网页         | AgentProxy：`plan_cot` / `deep_think` / 搜索 bar     |
| `chatglm-web`       | 智谱清言 / ChatGLM   | `think` / `text` / `search` + `search_results`       |
| `yuanbao-web`       | 腾讯元宝             | `deepSearch` 思考增量 + `searchGuid` 来源            |
| `anthropic`         | Anthropic 风格 SSE   | content_block 等（基础识别）                         |
| `generic`           | 未识别               | 仍可看 Events / Timeline / Raw                       |

> 厂商协议常变。若某站 Transcript 为空或工具卡对不上，请导出 **Raw / JSON** 开 Issue，并注明 URL。  
> 未列出的站点：有真实抓包再适配，不主动扫库。

---

<a name="快速开始"></a>

# 快速开始

### 前置

- Node.js 20+（建议）
- [pnpm](https://pnpm.io) 10.x（见 `packageManager` 字段）
- Chromium 内核浏览器（Chrome / Edge 等）

### 安装并加载

```bash
git clone https://github.com/FatMii/eventstream-panel.git
cd eventstream-panel
pnpm i
pnpm build
```

1. 打开 `chrome://extensions`，开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择仓库里的 **`dist/`**
3. 打开目标站点 → <kbd>F12</kbd> → **EventStream**
4. **刷新页面**（注入发生在 `document_start`），再触发流式接口

改代码时用 `pnpm dev` 监听构建，扩展管理页点「重新加载」即可。

更完整的协作与分支保护说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)、[docs/GITHUB_SETUP.md](./docs/GITHUB_SETUP.md)。

---

<a name="30-秒-demo"></a>

# 30 秒 Demo

```bash
pnpm build && pnpm demo
```

1. 浏览器打开 <http://127.0.0.1:8765>
2. 确认扩展已加载 → 打开 DevTools → **EventStream**
3. **刷新 Demo 页** → 点击 **Start stream**
4. 侧栏应出现流；Events / Timeline / Raw 有数据

---

<a name="开发"></a>

# 开发

```bash
pnpm build        # tsc --noEmit + 打包到 dist/
pnpm dev          # watch 构建
pnpm typecheck
pnpm lint
pnpm format
pnpm test-only    # parser / connect / export / spec / timing / request-view / close / ai-merge
```

| 路径                         | 职责                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| `src/content/inject-main.ts` | MAIN world：劫持 fetch / EventSource / XHR                    |
| `src/content/` + `bridge`    | ISOLATED：转发到扩展                                          |
| `src/background.ts`          | Service Worker 消息中继                                       |
| `src/panel/`                 | DevTools 面板 UI（`core` / `views` / `features` / `widgets`） |
| `src/shared/`                | 解析 · 时序 · Spec · 导出 · AI Profile / Merge                |
| `src/options/`               | 选项页                                                        |
| `_locales/`                  | i18n（`en` / `zh_CN`）                                        |
| `demo/`                      | 本地 SSE Demo 服务                                            |

发 PR 前请跑通：

```bash
pnpm format:check && pnpm lint && pnpm test-only && pnpm typecheck && pnpm build
```

---

<a name="怎么工作的"></a>

# 怎么工作的

```text
Page (MAIN)                    Extension                       DevTools
─────────────────────────      ─────────────────────           ──────────────
patch fetch / ES / XHR
        │
   clone() + pump  ──postMessage──► bridge ──► SW ──► EventStream Panel
   (or observe getReader)               │
        │                               └─ 页面自己的 body 消费不受影响
        ▼
   页面继续读原 Response
```

---

<a name="限制"></a>

# 限制

- 只面向 **Chromium** DevTools（不做 Firefox / Safari 面板）
- 抓不到页面 **Service Worker** 内发起的 fetch
- 更深的 Stream API hook（`pipeThrough` / `pipeTo` 等）尚未覆盖——有漏抓请带复现开 Issue
- AI Transcript 依赖各站私有协议，升级后可能需重新适配
- 当前需本地构建加载；**尚未上架** Chrome Web Store

---

<a name="参与贡献"></a>

# 参与贡献

Issue / PR 都欢迎，请先读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

写清：复现步骤、Chrome 版本、目标 URL、能否用本地 Demo 打出；涉及 Transcript 时请附 **Raw 或导出 JSON**（可脱敏）。

查看仓库 Issue / Discussions 了解正在推进的方向。厂商适配请「有抓包再开」，避免无样本空合。

---

<a name="开源协议"></a>

# 开源协议

本项目采用 **[MIT](./LICENSE)** 协议开源。

---

<p align="center">
  <a href="https://github.com/FatMii/eventstream-panel">github.com/FatMii/eventstream-panel</a>
</p>
