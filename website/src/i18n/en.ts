import type { UI } from "./types";

export const en: UI = {
  meta: {
    title: "SSE DevTools Panel — SSE / EventSource / NDJSON Debugger for Chrome & Edge",
    description:
      "SSE DevTools Panel is a Chromium DevTools extension for Chrome and Edge. Capture, parse, and visualize SSE / EventSource / NDJSON streams—timeline, conversation merge, and event-level debugging.",
    keywords:
      "SSE DevTools Panel, SSE debugger, EventSource, NDJSON, Chrome DevTools, Edge DevTools, streaming debug, AI chat stream, Server-Sent Events",
  },
  nav: {
    features: "Features",
    whatsNew: "What's new",
    install: "Get extension",
    themeDark: "Dark",
    themeLight: "Light",
    switchLang: "中文",
  },
  hero: {
    eyebrow: "Chrome & Edge DevTools · SSE / NDJSON",
    title: "Understand SSE streams in DevTools",
    lead: "Capture page SSE / NDJSON, parse events, and visualize the full stream in one DevTools panel.",
    ctaDemo: "See demo",
    proofLabel: "Product highlights",
    proofOpenSource: "open source",
    proofLocal: "local processing",
    proofExtension: "extension",
    maintained: "Actively maintained",
  },
  pulse: {
    live: "Actively shipping",
    changelogCta: "Read the Changelog",
    releasesCta: "GitHub Releases",
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
        title: "Real AI chats, merged live",
        description:
          "On sites like DeepSeek, thinking, content, and search merge into channels while the stream runs—no reading raw frames by hand.",
        image: "deepseek-conversation.gif",
        alt: "DeepSeek page with Conversation merge demo",
        tags: ["Conversation", "DeepSeek", "AI Web"],
      },
      {
        title: "Smooth scrolling on long streams",
        description:
          "Events, Conversation, and Raw use virtual scrolling—only on-screen rows render, so heavy streams stay responsive.",
        image: "virtual-scrolling.gif",
        alt: "Virtual scrolling demo with many events",
        tags: ["Virtual scroll", "Events", "Raw"],
      },
      {
        title: "Night theme for late debugging",
        description:
          "Switch Light / Night / Follow DevTools from the toolbar; preference syncs with Chrome for comfortable night work.",
        image: "night-theme.png",
        alt: "SSE DevTools night theme workbench",
        tags: ["Night", "Theme"],
      },
      {
        title: "Request context at a glance",
        description:
          "Inspect method, status, Content-Type, and headers in Request—sensitive fields are redacted so you can compare with the stream safely.",
        image: "tab-request.png",
        alt: "Request tab showing headers and basics",
        tags: ["Request", "Headers"],
      },
      {
        title: "Stats for stream health",
        description:
          "First-byte delay, duration, avg / max gap, and events per second in one place—pair with Anomalies / Spec when something looks off.",
        image: "dialog-stats.png",
        alt: "Stats dialog with stream performance metrics",
        tags: ["Stats", "Anomalies"],
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
    subtitle: "Pick one path. Use the offline zip if the store is unreachable.",
    storeTitle: "Chrome Web Store",
    storeBody: "Easiest when you can access Google—one-click install.",
    storeCta: "Install from Chrome",
    edgeTitle: "Microsoft Edge Add-ons",
    edgeBody: "One-click install for Edge users from the official Add-ons store.",
    edgeCta: "Install from Edge",
    offlineTitle: "Offline zip",
    offlineBadge: "No store needed",
    offlineBody:
      "Download zip → extract → open <code>chrome://extensions</code> or <code>edge://extensions</code> → enable Developer mode → Load unpacked <code>dist/</code>.",
    offlineCta: (version) => `Download v${version} offline zip`,
    footPrefix: "Developers can also build from",
    footReleases: "GitHub Releases",
    footSuffix:
      ". The browser may warn about an unverified extension in developer mode; all data stays on your machine.",
  },
  footer: {
    readme: "README",
    changelog: "Changelog",
  },
};
