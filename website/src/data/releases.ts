/**
 * Curated release pulse for the marketing site.
 * Keep in sync with root CHANGELOG.md / GitHub Releases when shipping.
 */
export type ReleasePulseItem = {
  version: string;
  date: string; // YYYY-MM-DD
  title: { zh: string; en: string };
  blurb: { zh: string; en: string };
  /** Numbered introduction lines, one capability each. */
  points: { zh: string; en: string }[];
};

function releaseCopy(zh: string[], en: string[]) {
  return {
    blurb: { zh: zh.join(""), en: en.join(" ") },
    points: zh.map((line, index) => ({ zh: line, en: en[index]! })),
  };
}

export const releasePulse: {
  items: ReleasePulseItem[];
} = {
  items: [
    {
      version: "1.4.0",
      date: "2026-11-05",
      title: {
        zh: "协议可改，卡顿可调，异常直达",
        en: "Pick the protocol, set the stall, jump straight to anomalies",
      },
      ...releaseCopy(
        [
          "对话页的协议可以手动指定，修改后这条流立即按新协议重拼。",
          "时序页工具条上可以改卡顿阈值，默认 400 毫秒。间隔超过这个值算一次停顿，异常扫描也按这个值。",
          "只有出问题的流，侧栏时间下面才有「N 处异常」，N 是问题条数。点开只列出这条流，点其中一行跳到对应事件。",
          "支持快捷键：? 看全表，P 暂停或恢复刷新，1–5 依次切到事件、请求、对话、时序、原始流。",
        ],
        [
          "Pick the protocol on Conversation yourself, and that stream is re-merged with it immediately.",
          "The stall threshold on the Timing toolbar can be changed (400 ms by default). A longer gap counts as a pause, and the anomaly scan uses that same value.",
          "Only a stream with problems shows “N anomalies” under its time in the sidebar, where N is the count. Opening it lists that stream only, and a row jumps to the event.",
          "Keyboard shortcuts are supported: ? for the full list, P to pause or resume refresh, 1–5 to switch Events, Request, Conversation, Timing, and Raw.",
        ],
      ),
    },
    {
      version: "1.3.0",
      date: "2026-10-12",
      title: {
        zh: "时序面板重做",
        en: "Timing redesign",
      },
      ...releaseCopy(
        [
          "Timeline 已改名为 Timing，中文标签是「时序」。",
          "时序页同时显示到达密度和等待时间，并支持缩放。",
          "阶段用色带标出，卡顿用浮标标出。",
          "可以按事件类型分行查看。",
        ],
        [
          "Timeline is now Timing.",
          "Timing shows arrival density and wait time together, and supports zoom.",
          "Phases are marked with color bands, and stalls are marked with pins.",
          "Rows can be split by event type.",
        ],
      ),
    },
    {
      version: "1.2.6",
      date: "2026-09-29",
      title: {
        zh: "新手引导",
        en: "Onboarding tour",
      },
      ...releaseCopy(
        [
          "首次打开会走一遍主要界面。",
          "之后可以在「更多」里重看这次引导。",
          "没有正在推流的页面时，可以加载内置样例流。",
        ],
        [
          "The first open walks through the main interface.",
          "You can replay the tour from More anytime.",
          "You can load a built-in sample stream when no page is streaming.",
        ],
      ),
    },
    {
      version: "1.2.5",
      date: "2026-09-17",
      title: {
        zh: "流列表显示起止时间",
        en: "Stream start and end times",
      },
      ...releaseCopy(
        ["侧栏每条流都会显示开始时间和结束时间。"],
        ["Each stream in the sidebar shows its start time and end time."],
      ),
    },
    {
      version: "1.2.4",
      date: "2026-09-10",
      title: {
        zh: "请求体支持折叠",
        en: "Foldable request bodies",
      },
      ...releaseCopy(
        [
          "Request 里的长内容默认收起，需要时再展开或复制。",
          "请求体捕获上限约 8MB，常见内容可以完整留下。",
        ],
        [
          "Long content in Request stays collapsed until you expand or copy it.",
          "The request-body capture limit is about 8MB, so typical payloads stay intact.",
        ],
      ),
    },
    {
      version: "1.2.0",
      date: "2026-08-22",
      title: {
        zh: "暗夜主题",
        en: "Night theme",
      },
      ...releaseCopy(
        ["工具栏可以切换浅色或暗夜，也可以跟随 DevTools。"],
        ["The toolbar can switch between Light and Night, or follow DevTools."],
      ),
    },
  ],
};

/** Format YYYY-MM-DD for display; always absolute (never “today”). */
export function formatReleaseDate(isoDate: string, locale: "zh" | "en"): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  if (locale === "zh") return `${y}年${m}月${d}日`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}
