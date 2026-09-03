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
    windowUrl: "F12 → SSE DevTools · /api/stream",
    imageAlt: "SSE DevTools Panel 面板总览：Streams 列表、Timeline 与事件详情",
  },
  pain: {
    title: "为什么需要它",
    items: [
      {
        title: "Network 覆盖不到这类流",
        body: "EventStream Tab 面向标准 SSE。很多 AI 流走 fetch + NDJSON / Connect+JSON，Network 多半只能看整段 Response，缺少按事件拆开的视图。",
      },
      {
        title: "只有整段耗时",
        body: "首包延迟、chunk 间隔、卡顿和重连，都藏在「整请求耗时」里，Network 不会单独标出来。",
      },
      {
        title: "对话散落在原始帧里",
        body: "思考、正文、工具调用混在 raw 数据中，要自己对照才能读完一轮回复；Conversation 会按通道自动合并。",
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
        title: "看清推流时序",
        description: "Timeline / Stats 标出首包、间隔与卡顿，比只看 Network 整段耗时更直观。",
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
        title: "长流也能顺畅滚动",
        description: "Events / 对话 / Raw 使用虚拟滚动：事件再多也只渲染可见区域，长连接调试不卡顿。",
        image: "virtual-scrolling.gif",
        alt: "虚拟滚动演示：大量事件仍流畅浏览",
        tags: ["Virtual scroll", "Events", "Raw"],
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
