/**
 * Try to pretty-print JSON. Returns original string if not valid JSON.
 */
export function tryFormatJson(text: string): { formatted: string; isJson: boolean } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { formatted: text, isJson: false };
  }

  // Single JSON value
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    trimmed === "null" ||
    trimmed === "true" ||
    trimmed === "false" ||
    /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      // fall through
    }
  }

  // NDJSON / multiple JSON objects line by line
  const lines = trimmed.split("\n");
  if (lines.length > 1) {
    const formattedLines: string[] = [];
    let allJson = true;
    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        formattedLines.push("");
        continue;
      }
      try {
        formattedLines.push(JSON.stringify(JSON.parse(t), null, 2));
      } catch {
        allJson = false;
        break;
      }
    }
    if (allJson) {
      return { formatted: formattedLines.join("\n\n"), isJson: true };
    }
  }

  return { formatted: text, isJson: false };
}

/**
 * Format each SSE event's data field when possible.
 */
export function formatEventData(data: string): string {
  return tryFormatJson(data).formatted;
}
