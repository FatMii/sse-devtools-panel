export function screenshotUrl(file: string, baseUrl = "/") {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}screenshots/${file}`;
}

export const heroDemo = {
  image: "panel-overview.gif",
  alt: "SSE DevTools Panel 面板总览：Streams 列表、Timeline 与事件详情",
} as const;

export const showcaseItems = [
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
] as const;

export const spotlightItems = [
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
] as const;

export const faqItems = [
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
] as const;
