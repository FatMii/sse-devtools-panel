import manifest from "../../../manifest.json";

/** 备案号下来后只改这里，然后重新构建。未取得号之前必须留空，页面不展示备案号。 */
export const compliance = {
  icpNumber: "",
  psbNumber: "",
  icpUrl: "https://beian.miit.gov.cn/",
  psbUrl: "https://beian.mps.gov.cn/",
} as const;

function siteOrigin(): string {
  const raw = import.meta.env.SITE || "https://fatmii.github.io/sse-devtools-panel";
  return raw.replace(/\/$/, "");
}

export const site = {
  name: "SSE DevTools Panel",
  tagline:
    "SSE DevTools Panel — SSE / EventSource / NDJSON debugger for Chromium DevTools (Chrome & Edge)",
  version: manifest.version,
  urls: {
    website: `${siteOrigin()}/`,
    chromeStore:
      "https://chromewebstore.google.com/detail/sse-devtools-panel/kffpkefnkmabnkhklmnjkihiiclggnni",
    edgeStore:
      "https://microsoftedge.microsoft.com/addons/detail/sse-devtools-panel/jmdceeplcpkajkiaiankkabblekdehmf",
    github: "https://github.com/FatMii/sse-devtools-panel",
    githubReleases: "https://github.com/FatMii/sse-devtools-panel/releases/latest",
    changelog: "https://github.com/FatMii/sse-devtools-panel/blob/main/CHANGELOG.md",
  },
  offlineZipPath(version: string, baseUrl = "/") {
    const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    return `${base}/releases/sse-devtools-panel-v${version}.zip`;
  },
} as const;
