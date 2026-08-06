export type NameValuePair = { name: string; value: string };

/** Parse URL query string into Network-style name/value pairs (keeps duplicates). */
export function parseQueryStringParams(url: string): NameValuePair[] {
  try {
    const u = new URL(url, "https://eventstream.local");
    const out: NameValuePair[] = [];
    u.searchParams.forEach((value, name) => {
      out.push({ name, value });
    });
    return out;
  } catch {
    const q = url.indexOf("?");
    if (q < 0) return [];
    return parseUrlEncodedPairs(url.slice(q + 1).split("#")[0] ?? "");
  }
}

/** Parse application/x-www-form-urlencoded text. */
export function parseUrlEncodedPairs(text: string): NameValuePair[] {
  const out: NameValuePair[] = [];
  if (!text.trim()) return out;
  for (const part of text.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const rawName = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? "" : part.slice(eq + 1);
    out.push({
      name: safeDecode(rawName.replace(/\+/g, " ")),
      value: safeDecode(rawValue.replace(/\+/g, " ")),
    });
  }
  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function looksLikeUrlEncoded(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  if (!trimmed.includes("=")) return false;
  return /^[^=&\s]+=/.test(trimmed) || trimmed.includes("&");
}

export function requestContentType(headers?: Record<string, string>): string | undefined {
  if (!headers) return undefined;
  return headers["content-type"] ?? headers["Content-Type"];
}
