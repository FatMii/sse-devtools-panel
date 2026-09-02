import manifest from "../../../manifest.json";

export const site = {
  name: "SSE DevTools Panel",
  tagline: "SSE / EventSource / NDJSON debugger for Chrome DevTools",
  version: manifest.version,
  urls: {
    chromeStore:
      "https://chromewebstore.google.com/detail/sse-devtools-panel/kffpkefnkmabnkhklmnjkihiiclggnni",
    github: "https://github.com/FatMii/sse-devtools-panel",
    githubReleases: "https://github.com/FatMii/sse-devtools-panel/releases/latest",
  },
  offlineZipPath(version: string, baseUrl = "/") {
    const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    return `${base}/releases/sse-devtools-panel-v${version}.zip`;
  },
} as const;
