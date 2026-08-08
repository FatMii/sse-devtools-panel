/** Pure helpers for Conversation / Raw text-pane updates. */

export type TextPaneUpdate =
  { mode: "noop" } | { mode: "append"; suffix: string } | { mode: "replace"; text: string };

/**
 * Decide how to update a text pane given the previously rendered text
 * and the newly available text. Append only when the new value is a pure
 * suffix extension of the previous one (common streaming case).
 */
export function planTextPaneUpdate(prevRendered: string, nextText: string): TextPaneUpdate {
  if (nextText === prevRendered) return { mode: "noop" };
  if (prevRendered.length > 0 && nextText.startsWith(prevRendered)) {
    return { mode: "append", suffix: nextText.slice(prevRendered.length) };
  }
  return { mode: "replace", text: nextText };
}
