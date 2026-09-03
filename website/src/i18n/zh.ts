import type { UI } from "./types";

export const zh: UI = {
  meta: {
    title: "SSE DevTools Panel",
    description: "Chrome DevTools 里的 SSE / EventSource / NDJSON 流式调试扩展",
  },
  nav: {
    features: "功能",
    install: "获取扩展",
    themeDark: "夜间",
    themeLight: "浅色",
    switchLang: "EN",
  },
  hero: {
    eyebrow: "Chrome DevTools · SSE / NDJSON",
    title: "在 DevTools 里看懂 SSE 流",
    lead: "告别流式碎片，自动捕获网页 SSE / NDJSON 流——解析、可视化，一个面板全看清。",
    ctaDemo: "查看演示",
    proofLabel: "产品要点",
    proofOpenSource: "开源",
    proofLocal: "处理，不上云",
    proofExtension: "扩展",
  },
  heroDemo: {
    ariaLabel: "产品演示",
    windowUrl: "F12 → SSE DevTools · /v1/chat/completions",
    imageAlt: "SSE DevTools Panel 面板总览：Streams 列表、Timeline 与事件详情",
  },
  pain: {
    title: "为什么需要它",
    items: [
      {
        title: "Network 不够用",
        body: "AI / 私有协议常是 NDJSON、Connect+JSON，EventStream Tab 帮不上忙。",
      },
      {
        title: "看不到节奏",
        body: "TTFT、chunk gap、卡顿与重连，在整请求耗时里看不见。",
      },
      {
        title: "对话难拼",
        body: "思考 / 正文 / 工具调用混在 raw 帧里，Conversation 自动分通道合并。",
      },
    ],
  },
  features: {
    title: "专为流式调试设计",
    subtitle: "装完即用，在 DevTools 里看清 SSE / NDJSON 的每一步。",
    tagsAria: (title) => `${title} 相关能力`,
    items: [
      {
        num: "01",
        title: "看清每一条事件",
        description: "fetch / EventSource / XHR 自动捕获，按流分组。",
        image: "tab-events.png",
        alt: "Events 标签页：按序列出流式事件",
        tags: ["Events", "Streams", "NDJSON"],
      },
      {
        num: "02",
        title: "看见流的节奏",
        description: "TTFT、chunk gap、卡顿一眼可见，不用猜 Network 耗时。",
        image: "tab-timeline.png",
        alt: "Timeline 标签页：事件间隔与卡顿可视化",
        tags: ["Timeline", "TTFT"],
      },
      {
        num: "03",
        title: "对话自动拼好",
        description: "思考、正文、工具调用分通道展示，告别 raw NDJSON。",
        image: "tab-conversation-content.png",
        alt: "Conversation 标签页：合并后的对话正文",
        tags: ["Conversation", "AI Web"],
      },
    ],
  },
  spotlight: {
    ariaLabel: "更多能力",
    items: [
      {
        title: "打开 F12 就能用",
        description: "无需代理或改代码，装完在 DevTools 面板里直接调试 SSE / NDJSON 流。",
        image: "main-workbench.png",
        alt: "SSE DevTools 主界面工作台",
        tags: ["DevTools", "MV3"],
      },
      {
        title: "导入导出与搜索",
        description: "大流量虚拟滚动、全局搜索、会话归档，长连接调试也不卡。",
        image: "virtual-scrolling.gif",
        alt: "虚拟滚动演示：大量事件仍流畅浏览",
        tags: ["Export", "Search"],
      },
    ],
  },
  faq: {
    title: "常见问题",
    subtitle: "安装即用，无需长篇教程。更多细节见 GitHub README。",
    footPrefix: "更多功能说明与截图：",
    footLink: "GitHub README",
    items: [
      {
        question: "支持哪些浏览器？",
        answer:
          "面向 Chromium 系浏览器（Chrome、Edge 等），需支持 Manifest V3 与 DevTools 扩展。安装后打开 F12，在顶部标签栏找到 SSE DevTools。",
      },
      {
        question: "离线包怎么装？",
        answerHtml:
          '下载 <a href="#install-offline">离线 zip</a> → 解压 → 打开 <code>chrome://extensions</code> → 开启开发者模式 → 加载已解压的 <code>dist/</code> 文件夹。',
      },
      {
        question: "数据会上传吗？",
        answer:
          "不会。扩展在本地解析与展示流式数据，不上传云端。离线加载时 Chrome 可能提示「未验证扩展」，属开发者模式正常现象。",
      },
      {
        question: "和 Network 面板有什么区别？",
        answer:
          "Network 看整段请求；SSE DevTools 专为流式设计——按事件解析、对话合并、时间线节奏与 TTFT，适合 AI 对话与 NDJSON 私有协议。",
      },
    ],
  },
  install: {
    title: "获取扩展",
    subtitle: "选一种方式即可。国内网络推荐离线包。",
    storeTitle: "Chrome 应用商店",
    storeBody: "能访问 Google 时最方便，一键安装。",
    storeCta: "前往商店安装",
    offlineTitle: "离线包",
    offlineBadge: "国内推荐",
    offlineBody:
      "下载 zip → 解压 → <code>chrome://extensions</code> 开启开发者模式 → 加载已解压的 <code>dist/</code>。",
    offlineCta: (version) => `下载 v${version} 离线包`,
    footPrefix: "开发者也可从",
    footReleases: "GitHub Releases",
    footSuffix:
      "获取源码自行构建。离线加载时 Chrome 可能提示「未验证扩展」，属开发者模式正常现象；数据仅本地处理。",
  },
  footer: {
    readme: "README",
  },
};
