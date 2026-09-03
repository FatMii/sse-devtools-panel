import type { UI } from "./types";

export const en: UI = {
  meta: {
    title: "SSE DevTools Panel",
    description: "SSE / EventSource / NDJSON debugger for Chrome DevTools",
  },
  nav: {
    features: "Features",
    install: "Get extension",
    themeDark: "Dark",
    themeLight: "Light",
    switchLang: "中文",
  },
  hero: {
    eyebrow: "Chrome DevTools · SSE / NDJSON",
    title: "Understand SSE streams in DevTools",
    lead: "Leave raw fragments behind—capture SSE / NDJSON from the page, parse and visualize in one panel.",
    ctaDemo: "See demo",
    proofLabel: "Product highlights",
    proofOpenSource: "open source",
    proofLocal: "local processing",
    proofExtension: "extension",
  },
  heroDemo: {
    ariaLabel: "Product demo",
    windowUrl: "F12 → SSE DevTools · /api/stream",
    imageAlt: "SSE DevTools Panel overview: Streams list, Timeline, and event details",
  },
  pain: {
    title: "Why you need it",
    items: [
      {
        title: "Network does not cover these streams",
        body: "The EventStream tab is built for standard SSE. Many AI streams use fetch + NDJSON / Connect+JSON, so Network mostly shows a whole Response body without a per-event view.",
      },
      {
        title: "Only total request duration",
        body: "First-byte delay, chunk gaps, stalls, and reconnects stay buried inside total request time—Network does not call them out.",
      },
      {
        title: "Chat is scattered in raw frames",
        body: "Thinking, content, and tool calls mix in raw data, so you have to reassemble a reply by hand—Conversation merges them by channel.",
      },
    ],
  },
  features: {
    title: "Built for stream debugging",
    subtitle: "Install and go—see every step of SSE / NDJSON inside DevTools.",
    tagsAria: (title) => `Capabilities for ${title}`,
    items: [
      {
        num: "01",
        title: "See every event",
        description: "Auto-capture fetch / EventSource / XHR and group by stream.",
        image: "tab-events.png",
        alt: "Events tab listing streamed events in order",
        tags: ["Events", "Streams", "NDJSON"],
      },
      {
        num: "02",
        title: "See stream timing",
        description:
          "Timeline and Stats mark first byte, gaps, and stalls—clearer than Network total duration alone.",
        image: "tab-timeline.png",
        alt: "Timeline tab visualizing event gaps and stalls",
        tags: ["Timeline", "TTFT"],
      },
      {
        num: "03",
        title: "Conversation, assembled",
        description: "Thinking, content, and tool calls in separate channels—no more raw NDJSON.",
        image: "tab-conversation-content.png",
        alt: "Conversation tab showing merged assistant content",
        tags: ["Conversation", "AI Web"],
      },
    ],
  },
  spotlight: {
    ariaLabel: "More capabilities",
    items: [
      {
        title: "Open F12 and debug",
        description:
          "No proxy or code changes—debug SSE / NDJSON streams directly in the DevTools panel.",
        image: "main-workbench.png",
        alt: "SSE DevTools main workbench",
        tags: ["DevTools", "MV3"],
      },
      {
        title: "Smooth scrolling on long streams",
        description:
          "Events, Conversation, and Raw use virtual scrolling—only on-screen rows render, so heavy streams stay responsive.",
        image: "virtual-scrolling.gif",
        alt: "Virtual scrolling demo with many events",
        tags: ["Virtual scroll", "Events", "Raw"],
      },
    ],
  },
  faq: {
    title: "FAQ",
    subtitle: "Install and use—no long tutorial required. See GitHub README for details.",
    footPrefix: "More features and screenshots:",
    footLink: "GitHub README",
    items: [
      {
        question: "Which browsers are supported?",
        answer:
          "Chromium-based browsers (Chrome, Edge, etc.) with Manifest V3 and DevTools extensions. After install, open F12 and select the SSE DevTools tab.",
      },
      {
        question: "How do I install the offline zip?",
        answerHtml:
          'Download the <a href="#install-offline">offline zip</a> → extract → open <code>chrome://extensions</code> → enable Developer mode → Load unpacked → select the <code>dist/</code> folder.',
      },
      {
        question: "Is my data uploaded?",
        answer:
          "No. The extension parses and displays streams locally. Chrome may warn about an unverified extension in developer mode—that is expected.",
      },
      {
        question: "How is this different from the Network panel?",
        answer:
          "Network shows whole requests; SSE DevTools is stream-native—per-event parsing, conversation merge, timeline rhythm, and TTFT for AI chats and NDJSON protocols.",
      },
    ],
  },
  install: {
    title: "Get the extension",
    subtitle: "Pick one path. Use the offline zip if the Web Store is unreachable.",
    storeTitle: "Chrome Web Store",
    storeBody: "Easiest when you can access Google—one-click install.",
    storeCta: "Install from store",
    offlineTitle: "Offline zip",
    offlineBadge: "No store needed",
    offlineBody:
      "Download zip → extract → open <code>chrome://extensions</code> → enable Developer mode → Load unpacked <code>dist/</code>.",
    offlineCta: (version) => `Download v${version} offline zip`,
    footPrefix: "Developers can also build from",
    footReleases: "GitHub Releases",
    footSuffix:
      ". Chrome may warn about an unverified extension in developer mode; all data stays on your machine.",
  },
  footer: {
    readme: "README",
  },
};
