/**
 * Curated release pulse for the marketing site.
 * Keep in sync with root CHANGELOG.md / GitHub Releases when shipping.
 */
export type ReleasePulseItem = {
  version: string;
  date: string; // YYYY-MM-DD
  title: { zh: string; en: string };
  blurb: { zh: string; en: string };
};

export const releasePulse: {
  items: ReleasePulseItem[];
} = {
  items: [
    {
      version: "1.3.0",
      date: "2026-10-12",
      title: {
        zh: "时序面板重做",
        en: "Timing redesign",
      },
      blurb: {
        zh: "Timeline 更名为 Timing / 时序：双轨到达与等待、缩放、阶段色带、卡顿浮标与按事件类型分行。",
        en: "Timeline is now Timing: dual-track arrival & wait-ms, zoom, phase bands, stall pins, and rows by event type.",
      },
    },
    {
      version: "1.2.6",
      date: "2026-09-29",
      title: {
        zh: "新手引导",
        en: "Onboarding tour",
      },
      blurb: {
        zh: "首次打开会走一遍主要界面。之后可在 More 里重看，或加载内置样例流。",
        en: "First open walks through the main UI. Replay it from More anytime, or load a built-in sample stream.",
      },
    },
    {
      version: "1.2.5",
      date: "2026-09-17",
      title: {
        zh: "流列表显示起止时间",
        en: "Stream start and end times",
      },
      blurb: {
        zh: "侧栏每条流都会显示开始和结束时间。",
        en: "Each stream in the sidebar shows its start and end time.",
      },
    },
    {
      version: "1.2.4",
      date: "2026-09-10",
      title: {
        zh: "请求体支持折叠",
        en: "Foldable request bodies",
      },
      blurb: {
        zh: "Request 里长内容默认收起，需要时再展开或复制。捕获上限约 8MB。",
        en: "Long bodies in Request stay collapsed until you expand or copy them. Capture limit is about 8MB.",
      },
    },
    {
      version: "1.2.0",
      date: "2026-08-22",
      title: {
        zh: "暗夜主题",
        en: "Night theme",
      },
      blurb: {
        zh: "工具栏可切换浅色 / 暗夜，也可跟随 DevTools。",
        en: "Switch Light or Night from the toolbar, or follow DevTools.",
      },
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
