/**
 * DevTools-style text filter: substring or RegExp.
 *
 * - Empty → match all
 * - `/pattern/flags` → explicit regex (default adds `i` if no flags)
 * - otherwise try `new RegExp(query, "i")`
 * - invalid regex → case-insensitive literal includes
 */
export interface TextFilter {
  isEmpty: boolean;
  test: (text: string) => boolean;
  /** Ranges for highlighting; empty if no matches / empty filter */
  matchRanges: (text: string) => Array<{ start: number; end: number }>;
}

export function compileTextFilter(query: string): TextFilter {
  const raw = query.trim();
  if (!raw) {
    return {
      isEmpty: true,
      test: () => true,
      matchRanges: () => [],
    };
  }

  const fromSlash = parseSlashRegExp(raw);
  if (fromSlash) {
    return fromRegExp(fromSlash);
  }

  try {
    return fromRegExp(new RegExp(raw, "i"));
  } catch {
    const lower = raw.toLowerCase();
    return {
      isEmpty: false,
      test: (text) => text.toLowerCase().includes(lower),
      matchRanges: (text) => literalRanges(text, raw),
    };
  }
}

function parseSlashRegExp(raw: string): RegExp | null {
  if (!raw.startsWith("/")) return null;
  const last = raw.lastIndexOf("/");
  if (last <= 0) return null;
  const pattern = raw.slice(1, last);
  let flags = raw.slice(last + 1);
  if (!flags) flags = "i";
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function fromRegExp(re: RegExp): TextFilter {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const globalRe = new RegExp(re.source, flags);
  return {
    isEmpty: false,
    test: (text) => {
      globalRe.lastIndex = 0;
      return globalRe.test(text);
    },
    matchRanges: (text) => {
      const ranges: Array<{ start: number; end: number }> = [];
      globalRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = globalRe.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (end === start) {
          // Avoid infinite loop on zero-length matches
          globalRe.lastIndex = start + 1;
          continue;
        }
        ranges.push({ start, end });
        if (!globalRe.global) break;
      }
      return ranges;
    },
  };
}

function literalRanges(text: string, query: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return ranges;
  let i = 0;
  while (i < text.length) {
    const hit = lower.indexOf(q, i);
    if (hit === -1) break;
    ranges.push({ start: hit, end: hit + query.length });
    i = hit + q.length;
  }
  return ranges;
}
