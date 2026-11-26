import type { UI } from "./types";

export const zh: UI = {
  meta: {
    title: "SSE DevTools Panel — Chrome / Edge 的 SSE / EventSource / NDJSON 流式调试扩展",
    description:
      "SSE DevTools Panel 是面向 Chromium DevTools（Chrome / Edge）的 SSE / EventSource / NDJSON 流式调试扩展。自动捕获网页流、按事件解析与可视化，支持时序分析、对话合并与长流调试。",
    keywords:
      "SSE DevTools Panel, SSE 调试, EventSource, NDJSON, Chrome DevTools, Edge DevTools, 流式调试, AI 对话流, Server-Sent Events",
  },
  nav: {
    features: "功能",
    whatsNew: "更新动态",
    install: "获取扩展",
    themeDark: "夜间",
    themeLight: "浅色",
    switchLang: "EN",
  },
  hero: {
    eyebrow: "Chrome & Edge DevTools · SSE / NDJSON",
    title: "在 DevTools 里看懂 SSE 流",
    lead: "自动捕获网页 SSE / NDJSON，按事件解析与可视化，一个面板看清整条流。",
    ctaDemo: "查看演示",
    proofLabel: "产品要点",
    proofOpenSource: "开源",
    proofLocal: "处理，不上云",
    proofExtension: "扩展",
    maintained: "持续维护中",
  },
  pulse: {
    live: "活跃维护",
    changelogCta: "查看 Changelog",
    releasesCta: "GitHub Releases",
  },
  heroDemo: {
    ariaLabel: "产品演示",
    windowUrl: "F12 → SSE DevTools · /api/stream",
    imageAlt: "SSE DevTools Panel 面板总览：Streams 列表、时序与事件详情",
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
        description:
          "到达密度、等待(ms)、阶段色带、卡顿浮标，按事件类型分行。卡顿阈值直接在工具条上调，默认 400 毫秒。",
        image: "tab-timing.png",
        alt: "时序标签页：到达密度、等待轨与卡顿浮标",
        tags: ["时序", "TTFT", "缩放"],
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
        title: "真实站点对话也能拼好",
        description:
          "DeepSeek 等 AI 网页推流时，思考 / 正文 / 搜索会按通道合并，不必对着 raw 帧硬读。",
        image: "deepseek-conversation.gif",
        alt: "DeepSeek 网页与 Conversation 合并演示",
        tags: ["Conversation", "DeepSeek", "AI Web"],
      },
      {
        title: "协议先自动判断，也能手改",
        description:
          "对话页的「协议:」默认自动识别；判断不准就手选一个，整条流按新协议重拼，切回「自动」会再识别一次。",
        image: "conversation-profile.gif",
        alt: "在对话页改选协议，这条流按新协议重新拼",
        tags: ["Conversation", "协议"],
      },
      {
        title: "哪条流有问题，一眼看到",
        description:
          "只有出问题的流，时间下面才会多出「N 处异常」，N 是问题条数。点开只列这一条，点其中一行跳到对应事件；等得比卡顿阈值更久，也算一条。「更多 → 异常扫描」一次扫全部流。",
        image: "stream-anomalies.gif",
        alt: "从左侧点开这一条流的异常，并跳到对应事件",
        tags: ["异常扫描", "时序"],
      },
      {
        title: "长流也能顺畅滚动",
        description:
          "Events / 对话 / Raw 使用虚拟滚动：事件再多也只渲染可见区域，长连接调试不卡顿。",
        image: "virtual-scrolling.gif",
        alt: "虚拟滚动演示：大量事件仍流畅浏览",
        tags: ["Virtual scroll", "Events", "Raw"],
      },
      {
        title: "暗夜主题护眼",
        description:
          "工具栏切换浅色 / 暗夜 / 跟随 DevTools，偏好保存在 Chrome 同步，夜间调试更舒服。",
        image: "night-theme.png",
        alt: "SSE DevTools 暗夜主题界面",
        tags: ["Night", "Theme"],
      },
      {
        title: "请求上下文一眼清",
        description:
          "Request 查看方法、状态、Content-Type 与头信息，敏感字段自动脱敏，对照流内容更方便。",
        image: "tab-request.png",
        alt: "Request 标签页：请求头与基础信息",
        tags: ["Request", "Headers"],
      },
      {
        title: "Stats 看清流健康度",
        description:
          "首包延迟、总时长、平均 / 最大间隔、每秒事件数一屏汇总；也可配合 Anomalies / Spec 排查异常。",
        image: "dialog-stats.png",
        alt: "Stats 对话框：流式性能指标",
        tags: ["Stats", "Anomalies"],
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
          "Network 看整段请求；SSE DevTools 专为流式设计——按事件解析、对话合并、时序节奏与 TTFT，适合 AI 对话与 NDJSON 私有协议。",
      },
      {
        question: "有快捷键吗？",
        answer:
          "有，面板获得焦点、光标不在输入框时生效。按 ? 打开完整列表：P 暂停或恢复界面刷新，1–5 依次切到事件、请求、对话、时序、原始流，/ 全局搜索，E 导出当前流为 JSON，← → 在事件抽屉里前后翻，Esc 关掉菜单。入口也在「更多 → 快捷键」。",
      },
    ],
  },
  install: {
    title: "获取扩展",
    subtitle: "选一种方式即可。国内网络推荐离线包。",
    storeTitle: "Chrome 应用商店",
    storeBody: "能访问 Google 时最方便，一键安装。",
    storeCta: "前往 Chrome 安装",
    edgeTitle: "Microsoft Edge 加载项",
    edgeBody: "Edge 用户可从官方加载项商店一键安装。",
    edgeCta: "前往 Edge 安装",
    offlineTitle: "离线包",
    offlineBadge: "国内推荐",
    offlineBody:
      "下载 zip → 解压 → <code>chrome://extensions</code> 或 <code>edge://extensions</code> 开启开发者模式 → 加载已解压的 <code>dist/</code>。",
    offlineCta: (version) => `下载 v${version} 离线包`,
    footPrefix: "开发者也可从",
    footReleases: "GitHub Releases",
    footSuffix:
      "获取源码自行构建。离线加载时浏览器可能提示「未验证扩展」，属开发者模式正常现象；数据仅本地处理。",
  },
  footer: {
    readme: "README",
    changelog: "Changelog",
    privacy: "隐私说明",
    personal: "本站为个人开源项目，扩展免费使用，非经营性网站。",
  },
  privacy: {
    title: "隐私说明",
    updated: "最近更新：2026-08-08",
    sections: [
      {
        heading: "这个扩展处理哪些数据",
        paragraphs: [
          "SSE DevTools Panel 是运行在 Chrome 和 Edge 开发者工具里的扩展，用来调试 SSE、EventSource、NDJSON 和 Connect+JSON 流。下面这些数据只留在你的电脑上，除非你自己导出或复制走。扩展没有上传这些数据的服务器。",
        ],
      },
      {
        heading: "面板里看得到的内容",
        paragraphs: [
          "网页已经收到的流式响应正文，以及能取到的请求信息：URL、方法、状态码、Content-Type、传输方式。",
          "请求头和响应头会按常见敏感名称自动打码，例如 Authorization、Cookie，以及名称里带 token、api-key 的头。打码只覆盖已知命名方式，自定义头不一定都能识别。",
          "请求体只保留文本预览。特别大的内容会在界面里截断并标明。由这些内容生成的事件、时序、原文和对话合并视图也只在本地面板里展示。",
        ],
      },
      {
        heading: "存在这台设备上的内容",
        paragraphs: [
          "语言和界面偏好存在浏览器的 chrome.storage 里。只有你主动保存流时，才会把这份记录写入本地 IndexedDB，其中可以包含上面列出的同类内容。",
          "导出 JSON、CSV、fixture 或复制时，会带上当前这条记录里已有的内容。分享到工单或发给别人之前，请自行去掉密钥。",
        ],
      },
      {
        heading: "扩展不会做的事",
        paragraphs: [
          "没有收集扩展数据的后端，不出售用户数据，也不把这些数据用于广告。扩展不从登录表单里故意抓取密码；请求体预览只反映页面自己发出的流式请求。",
          "storage 权限用于本机偏好和可选的本地存档。主机权限用于观察你正在调试的页面上的流式响应，数据在本地面板展示，只有你选择保存或导出时才会离开当前这条记录。",
        ],
      },
      {
        heading: "联系",
        paragraphs: ["隐私问题请到 GitHub 仓库提交 issue。国内访问 GitHub 可能较慢或不稳定。"],
      },
    ],
  },
};
