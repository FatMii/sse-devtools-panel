<p align="center">
  <img src="assets/icons/sse-devtools-icon-512.png" alt="SSE DevTools Panel" width="160" height="160">
</p>

<h1 align="center">SSE DevTools Panel</h1>

<p align="center">
  <em>SSE / EventSource / NDJSON debugger for Chrome DevTools</em>
</p>

<p align="center"><a href="./README.md">English</a></p>

<p align="center">
  <strong>Chrome 扩展：在 DevTools 里调试网页的 SSE / EventSource / NDJSON 流。</strong><br/>
  安装后打开 F12 → SSE DevTools：事件列表、对话、时间线与全局搜索，都能在面板里直接看。<br/>
  适合 AI 对话、通知推送、进度上报等长连接场景。
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/sse-devtools-panel/kffpkefnkmabnkhklmnjkihiiclggnni"><img alt="Chrome Web Store" src="https://img.shields.io/chrome-web-store/v/kffpkefnkmabnkhklmnjkihiiclggnni?label=Chrome%20Web%20Store"></a>
  &nbsp;
  <a href="https://github.com/FatMii/sse-devtools-panel/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/FatMii/sse-devtools-panel/actions/workflows/ci.yml/badge.svg"></a>
  &nbsp;
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  &nbsp;
  <a href="#"><img alt="Platform" src="https://img.shields.io/badge/Platform-Chromium%20DevTools-blue"></a>
  &nbsp;
  <a href="#"><img alt="Manifest" src="https://img.shields.io/badge/Manifest-V3-informational"></a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/sse-devtools-panel/kffpkefnkmabnkhklmnjkihiiclggnni"><strong>从 Chrome 应用商店安装</strong></a>
</p>

---

<p align="center">
  <img width="1400" alt="面板总览" src="docs/assets/screenshots/panel-overview.gif">
</p>

---

# 目录

- [目录](#目录)
- [为什么需要它](#为什么需要它)
- [它是什么 / 不是什么](#它是什么--不是什么)
- [功能特性](#功能特性)
  - [🎣 流式捕获](#-流式捕获)
  - [📚 Streams 侧栏](#-streams-侧栏)
  - [📋 Events](#-events)
  - [📨 Request](#-request)
  - [🧠 对话（Conversation）](#-对话conversation)
  - [⏱ Timeline](#-timeline)
  - [📄 Raw](#-raw)
  - [⚡ 虚拟滚动](#-虚拟滚动)
  - [🛠 分析与工具栏](#-分析与工具栏)
  - [💾 导入 / 导出 / 归档](#-导入--导出--归档)
  - [🌐 国际化与设置](#-国际化与设置)
- [界面截图](#界面截图)
  - [主界面](#主界面)
  - [工具栏与更多菜单](#工具栏与更多菜单)
  - [Demo 页联调](#demo-页联调)
- [已支持的 AI Web 厂商](#已支持的-ai-web-厂商)
- [快速开始](#快速开始)
  - [前置](#前置)
  - [安装并加载](#安装并加载)
- [30 秒 Demo](#30-秒-demo)
- [开发](#开发)
- [限制](#限制)
- [参与贡献](#参与贡献)
- [致谢](#致谢)
- [开源协议](#开源协议)

---

<a name="为什么需要它"></a>

# 为什么需要它

Chrome Network 对**标准 SSE**已有请求详情里的 [EventStream](https://developer.chrome.com/docs/devtools/network/reference#analyze-events-in-a-stream) Tab（与 Headers / Response 同级），可以边接收流数据边看事件列表。

但对很多 AI / 业务流不够用。它们通常不是单纯的 EventSource，常见问题是：

- 多用 **`fetch` + 自定义 SSE / NDJSON / Connect+JSON**，Network 里经常只剩难读的 Response 碎片，或 EventStream Tab 空白 / 帮不上忙
- **看不到流内节奏**（TTFT、chunk gap、卡顿分布、重连标记）
- **AI 对话难读**：思考 / 正文 / 工具调用 / 搜索来源混在原始帧里，需要人工拼

| 场景                                          | Chrome Network             | SSE DevTools Panel                        |
| --------------------------------------------- | -------------------------- | ----------------------------------------- |
| 标准 SSE（EventSource / 部分 fetch）          | 请求详情有 EventStream Tab | 同样可看，并带过滤、JSON 树、导出         |
| AI / 私有协议（NDJSON、Connect+JSON、厂商帧） | 多半是原文碎片，难拼成对话 | Profile 识别 + **对话**分通道合并         |
| 流内时序与卡顿                                | 基本只有整请求耗时         | Timeline + Stats（TTFT / gap / events·s） |
| 规范与异常                                    | 无针对性扫描               | SSE Spec 告警 · Anomalies                 |
| 网页搜索等工具结果                            | 埋在 raw 里                | 归一成 `web_search` 卡片（查询 + 来源）   |

---

<a name="它是什么--不是什么"></a>

# 它是什么 / 不是什么

**SSE DevTools Panel 是**

- 独立的 Chromium **DevTools 面板**（F12 → SSE DevTools）
- 面向开发者的流式调试工作台：列表 · 时序 · 请求 · 对话 · 导出回放

**SSE DevTools Panel 不是**

- Network 面板的替代品（Headers 全量审计仍以 Network 为准）
- 通用抓包工具 / MITM 代理

---

<a name="功能特性"></a>

# 功能特性

- **暗夜风格** — 工具栏可切换浅色 / 暗夜 / 跟随 DevTools 主题（偏好保存在 Chrome 同步存储；Options 页不受影响）

<a name="流式捕获"></a>

## 🎣 流式捕获

- **传输** — 支持 `fetch`、`EventSource`、`XHR` 发起的流
- **格式** — SSE（`text/event-stream`）、NDJSON、Connect+JSON
- **独立查看** — 面板可读流内容，页面原有逻辑不受影响
- **生命周期** — 记录中止、错误、关闭原因，以及 EventSource 重连与 `Last-Event-ID`
- **减少误报** — 确认响应是流式内容后，才出现在侧栏列表，降低普通 JSON / 埋点请求混入

<a name="streams-侧栏"></a>

## 📚 Streams 侧栏

- 实时列出本页捕获到的流：方法、URL、状态、事件数
- 支持按 URL 搜索，并按传输类型筛选（全部类型 / Fetch / EventSource / XHR）
- 过滤后能看清当前匹配条数与总条数
- 侧栏宽度可拖拽调整

<img width="280" alt="Streams 侧栏" src="docs/assets/screenshots/streams-sidebar.png">

## 📋 Events

按条查看流事件：序号、到达时间、事件名、数据摘要。

- **虚拟滚动** — 列表变长时只画当前看得见的几行，滚动更稳
- 点击行可展开 JSON，支持折叠浏览
- 支持文本或正则过滤事件 / 数据
- 列宽可拖拽调整
- 可与 Timeline、Raw 联动跳转定位

<p align="center">
  <img width="1200" alt="Events Tab" src="docs/assets/screenshots/tab-events.png">
</p>

## 📨 Request

查看这条流对应的请求信息（类似 Network）：

- 请求头与请求体
- 对常见敏感请求头自动脱敏（如 `Authorization` / `Cookie` / `*token*` / `*api-key*`；非常用头名可能未覆盖）
- 与方法、URL、状态等基础信息同屏查看

<p align="center">
  <img width="1200" alt="Request Tab" src="docs/assets/screenshots/tab-request.png">
</p>

<a name="conversation"></a>

## 🧠 对话（Conversation）

把流里的碎片合成可读对话，按通道分开看：

| 通道       | 能看到什么                                |
| ---------- | ----------------------------------------- |
| **正文**   | 最终回答                                  |
| **思考**   | 思考过程 / 深度搜索过程                   |
| **工具**   | 函数调用；网页搜索会整理成查询 + 来源卡片 |
| **元数据** | 结束原因、用量、模型、协议类型等          |

- 顶部可看到当前识别到的协议与站点提示
- 工具卡可折叠；网页搜索展示查询芯片与结果列表（标题 / URL / 摘要）
- **虚拟滚动** — 正文、思考偏长时不会整段塞进页面，滚动更稳
- 当前通道内容可一键复制
- 国内主流 AI 网页与 OpenAI 兼容协议大多能合并（见下方[支持矩阵](#已支持的-ai-web-厂商)）

<p align="center">
  <img width="1200" alt="对话正文" src="docs/assets/screenshots/tab-conversation-content.png">
</p>

<p align="center">
  <img width="1200" alt="对话思考" src="docs/assets/screenshots/tab-conversation-think.png">
</p>

<p align="center">
  <img width="1200" alt="对话 工具 · 网页搜索" src="docs/assets/screenshots/tab-conversation-tools.png">
</p>

## ⏱ Timeline

用时间轴看这条流「什么时候到、中间卡了多久」：

- **到达时间线** — 每个事件按到达时刻排在轴上；点击可跳到 Events 对应行
- **卡顿高亮** — 与上一条间隔 ≥250ms 的事件标红，方便找卡顿点
- **间隔分布** — 相邻事件等待时长的直方图，长停顿一眼可见
- **重连标记** — EventSource 重连会出现在时间轴上，并列出重连次数与 Last-Event-ID

<p align="center">
  <img width="1200" alt="Timeline Tab" src="docs/assets/screenshots/tab-timeline.png">
</p>

## 📄 Raw

查看这条流的原文，方便和 Events / 对话等视图对照：

- 展示按事件拼回的完整原文
- **虚拟滚动** — 原文偏长时滚动更稳
- 支持一键复制

<a name="虚拟滚动"></a>

## ⚡ 虚拟滚动

调试流式接口时，事件列表会随推流变长，对话和 Raw 里也会出现偏长的文本。全部一次性画进页面，面板会发沉。

Events、对话（正文 / 思考）、Raw 都用了虚拟滚动：屏幕外的先不画，滚到哪再渲染到哪。滚动条仍按全文长度计算；实时推流时也可以跟着停在最新内容底部。

<p align="center">
  <img width="1200" alt="虚拟滚动" src="docs/assets/screenshots/virtual-scrolling.gif">
</p>

<a name="分析与工具栏"></a>

## 🛠 分析与工具栏

| 能力            | 说明                                                       |
| --------------- | ---------------------------------------------------------- |
| **暂停 / 继续** | 只暂停界面刷新，后台仍继续捕获；继续后会补上最新列表与详情 |
| **Stats**       | 首包延迟、总时长、平均 / 最大间隔、每秒事件数等            |
| **Anomalies**   | 扫描空数据、异常间隔等可疑情况                             |
| **Spec**        | 对照 SSE 规范提示字段、换行、BOM 等问题                    |
| **Search All**  | 跨多条流全局搜索                                           |
| **Clear**       | 清空当前会话已捕获的流                                     |
| **Settings**    | 打开选项页（语言等）                                       |

<p align="center">
  <img width="1200" alt="Stats" src="docs/assets/screenshots/dialog-stats.png">
</p>

<a name="导入--导出--归档"></a>

## 💾 导入 / 导出 / 归档

- **导出** — 可导出 JSON、CSV，或 `.sse` 原文文件
- **导入** — 导入本地 JSON，在面板里直接回放查看
- **保存 / 存档** — 把选中的流存到本地，之后再打开翻看

<a name="国际化与设置"></a>

## 🌐 国际化与设置

- 界面支持中文与 English
- 可在选项页选择：跟随浏览器，或固定某一种语言

---

<a name="界面截图"></a>

# 界面截图

## 主界面

侧栏选流，右侧用 Tab 切换 Events / Request / Conversation / Timeline / Raw。

<p align="center">
  <img width="1400" alt="主界面" src="docs/assets/screenshots/main-workbench.png">
</p>

## 工具栏与更多菜单

常用操作放在顶栏：导入、导出、存档、Stats、暂停、清空；Anomalies、Spec、全局搜索、设置放在「更多」里。

<p align="center">
  <img width="1000" alt="工具栏" src="docs/assets/screenshots/toolbar.png">
</p>

## Demo 页联调

本地 Demo 可一键发起 SSE，用来确认扩展是否正常工作。

<p align="center">
  <img width="1000" alt="Demo 页" src="docs/assets/screenshots/demo-page.png">
</p>

---

<a name="已支持的-ai-web-厂商"></a>

# 已支持的 AI Web 厂商

对话视图会按协议类型合并内容。当前已适配：

| Profile             | 典型站点 / 形态      | 说明                           |
| ------------------- | -------------------- | ------------------------------ |
| `openai-compatible` | 各类 OpenAI 兼容 API | 正文 / 思考 / 工具调用         |
| `deepseek-web`      | DeepSeek 网页        | 思考 + 正文；支持搜索工具      |
| `doubao-web`        | 豆包网页             | 思考与正文拆分；搜索结果去重   |
| `kimi-web`          | Kimi                 | 思考 / 正文 / 搜索             |
| `qwen-web`          | 通义千问网页         | 计划思考 / 深度思考 / 搜索     |
| `chatglm-web`       | 智谱清言 / ChatGLM   | 思考 / 正文 / 搜索结果         |
| `yuanbao-web`       | 腾讯元宝             | 深度搜索思考 + 来源            |
| `anthropic`         | Anthropic 风格 SSE   | 仅协议识别 — 对话合并尚未实现  |
| `generic`           | 未识别               | 仍可看 Events / Timeline / Raw |

> 各站协议常变。若对话视图为空或工具卡不对，请导出 Raw 或 JSON 并注明 URL。  
> 未列出的站点：有真实样本后再适配。  
> CI 回归样本：[`fixtures/vendors/`](./fixtures/vendors/)。

---

<a name="快速开始"></a>

# 快速开始

### 前置

- Node.js 20+（`engines`；CI 使用 Node.js 22）
- [pnpm](https://pnpm.io) 10.x（见 `packageManager` 字段）
- Chromium 内核浏览器（Chrome / Edge 等）

### 安装并加载

**推荐：** 从 [Chrome 应用商店](https://chromewebstore.google.com/detail/sse-devtools-panel/kffpkefnkmabnkhklmnjkihiiclggnni) 安装，然后打开目标页 → <kbd>F12</kbd> → **SSE DevTools** → **先刷新页面**再触发流式请求。

**从源码加载**（开发 / 本地构建）：

```bash
git clone https://github.com/FatMii/sse-devtools-panel.git
cd sse-devtools-panel
pnpm i
pnpm build
```

1. 打开 `chrome://extensions`，开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择仓库里的 **`dist/`**
3. 打开目标站点 → <kbd>F12</kbd> → **SSE DevTools**
4. **刷新页面**后再触发流式接口（扩展需在页面加载时生效）

改代码时用 `pnpm dev` 监听构建，扩展管理页点「重新加载」即可。

更完整的协作说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

<a name="30-秒-demo"></a>

# 30 秒 Demo

```bash
pnpm build && pnpm demo
```

1. 浏览器打开 <http://127.0.0.1:8765>
2. 确认扩展已加载 → 打开 DevTools → **SSE DevTools**
3. **刷新 Demo 页** → 分别试 **Fetch SSE**、**EventSource**、**XHR SSE**、**Fetch NDJSON**
4. 侧栏应出现流；Events / Conversation / Timeline / Raw 等 Tab 有数据

---

<a name="开发"></a>

# 开发

```bash
pnpm build        # 类型检查 + 打包到 dist/
pnpm dev          # 监听构建
pnpm typecheck
pnpm lint
pnpm format
pnpm test         # Vitest 单测（src/**/__tests__/**/*.test.ts）
pnpm test:watch   # Vitest 监听模式
```

| 路径                         | 职责                                                 |
| ---------------------------- | ---------------------------------------------------- |
| `src/content/inject/`        | 页面侧捕获：fetch / EventSource / XHR 补丁           |
| `src/content/inject-main.ts` | 注入入口（加载上述补丁）                             |
| `src/content/bridge.ts`      | 把捕获结果转发到扩展                                 |
| `src/background.ts`          | 扩展后台消息中继                                     |
| `src/devtools/`              | DevTools 面板注册入口                                |
| `src/panel/`                 | 面板 UI（`core` / `views` / `features` / `widgets`） |
| `src/shared/`                | 解析、时序、Spec、导出等公共逻辑                     |
| `src/shared/ai-merge/`       | 对话合并（各厂商 Profile）                           |
| `src/options/`               | 选项页                                               |
| `_locales/`                  | 中英文案（`en` / `zh_CN`）                           |
| `demo/`                      | 本地 Demo 服务                                       |
| `scripts/`                   | 构建与单测脚本                                       |

发 PR 前请跑通：

```bash
pnpm format:check && pnpm lint && pnpm test && pnpm typecheck && pnpm build
```

---

<a name="限制"></a>

# 限制

- 仅支持 Chromium 系浏览器的 DevTools（Chrome / Edge 等），暂无 Firefox / Safari 面板
- 抓不到页面 Service Worker 里发起的请求
- 部分更深层的流式 API 用法可能漏抓；若遇到请带复现步骤开 Issue
- 扩展怎么判断「这是一条要抓的流」：先看响应头有没有正经流类型（如 `Content-Type: text/event-stream` / NDJSON / Connect+JSON）。很多 AI 网关会标错或干脆不标——响应仍是 SSE 正文，但写成 `application/json`、`text/plain`，或响应头里根本没有 `Content-Type`。这时会再看请求是否像在要流：例如 `Accept: text/event-stream`、POST body 含 `"stream": true`、URL 带 `?stream=true`。Demo 里的 **Fetch SSE (JSON CT)** 就是「响应标成 JSON、请求 body 带 stream:true」这种。普通查用户资料一类的 JSON 接口没有这些提示，仍然不会进侧栏。若请求侧已有上述流式线索，响应还在 pending 时就会先出现在 Streams 列表；确认不是流后会把这条预创建行移除
- 对话视图依赖各站私有协议，站点改版后可能需要重新适配
- 若流已开始后再打开 SSE 面板，background 会回放该 tab 的近期缓冲（约 2000 条 / 4MB 上限）；超限会丢最旧数据，扩展 Service Worker 被回收后缓冲也会清空

---

<a name="参与贡献"></a>

# 参与贡献

欢迎提 Issue / PR，请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

反馈问题时尽量写清：复现步骤、Chrome 版本、目标 URL，以及本地 Demo 能否复现。若涉及对话视图，请附上 Raw 或导出的 JSON（可脱敏）。

厂商适配请附真实样本后再开 Issue，便于对照协议改动。

---

<a name="致谢"></a>

# 致谢

- **界面图标** — 改编自 [Lucide](https://lucide.dev)（[ISC](https://lucide.dev/license)）。新增图标请同样使用 Lucide，见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
- **运行平台** — 基于 Chromium DevTools 扩展能力。
- **协议参考** — SSE 对照 [HTML Living Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html)；Connect+JSON 对照 [Connect 协议](https://connectrpc.com/docs/protocol)。

---

<a name="开源协议"></a>

# 开源协议

本项目采用 **[MIT](./LICENSE)** 协议开源。

---
