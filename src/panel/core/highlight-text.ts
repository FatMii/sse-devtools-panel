import type { TextFilter } from "../../shared/text-filter";

/**
 * Fill `container` with `text`, wrapping match ranges in `<mark class="search-mark">`.
 * Empty filter / no ranges → plain textContent.
 */
export function renderHighlightedText(
  container: HTMLElement,
  text: string,
  filter: TextFilter,
): void {
  if (filter.isEmpty) {
    container.textContent = text;
    return;
  }

  const ranges = filter.matchRanges(text);
  if (ranges.length === 0) {
    container.textContent = text;
    return;
  }

  container.replaceChildren();
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      container.appendChild(document.createTextNode(text.slice(cursor, range.start)));
    }
    const mark = document.createElement("mark");
    mark.className = "search-mark";
    mark.textContent = text.slice(range.start, range.end);
    container.appendChild(mark);
    cursor = range.end;
  }
  if (cursor < text.length) {
    container.appendChild(document.createTextNode(text.slice(cursor)));
  }
}
