import { compileTextFilter } from "../shared/text-filter";

/**
 * Build an expandable JSON tree (Chrome DevTools–style).
 */

export function tryParseJsonValue(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false };

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    // continue
  }

  // Multiline data that is NDJSON — wrap as array of parsed lines
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    try {
      return { ok: true, value: lines.map((l) => JSON.parse(l)) };
    } catch {
      return { ok: false };
    }
  }

  return { ok: false };
}

export function createJsonTree(value: unknown, options?: { defaultExpandDepth?: number }): HTMLElement {
  const depth = options?.defaultExpandDepth ?? 1;
  const root = document.createElement("div");
  root.className = "json-tree";
  root.appendChild(renderNode(null, value, 0, depth, true));
  return root;
}

/**
 * Filter / highlight nodes by query (substring or RegExp). Returns match count.
 * Empty query clears filter and shows the full tree.
 */
export function applyTreeSearch(root: HTMLElement, query: string): number {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(".json-node"));
  const filter = compileTextFilter(query);

  for (const node of nodes) {
    node.classList.remove("search-hidden", "search-match");
  }

  if (filter.isEmpty) {
    return 0;
  }

  const matches = new Set<HTMLElement>();
  for (const node of nodes) {
    const text = node.dataset.searchText ?? "";
    if (filter.test(text)) {
      matches.add(node);
      node.classList.add("search-match");
    }
  }

  const keep = new Set<HTMLElement>();
  for (const match of matches) {
    let cur: HTMLElement | null = match;
    while (cur && cur !== root) {
      if (cur.classList.contains("json-node")) {
        keep.add(cur);
        if (cur.classList.contains("json-collection")) {
          expandCollection(cur);
        }
      }
      cur = cur.parentElement;
    }
  }

  for (const node of nodes) {
    if (!keep.has(node)) {
      node.classList.add("search-hidden");
    }
  }

  return matches.size;
}

function expandCollection(row: HTMLElement): void {
  if (row.classList.contains("expanded")) return;

  const head = row.querySelector<HTMLElement>(":scope > .json-toggle-line");
  const children = row.querySelector<HTMLElement>(":scope > .json-children");
  const closeLine = row.querySelector<HTMLElement>(":scope > .json-close");
  if (!head) return;

  const arrow = head.querySelector<HTMLElement>(".json-arrow");
  const preview = head.querySelector<HTMLElement>(".json-preview");
  const openBrace = head.querySelector<HTMLElement>(".json-brace");

  row.classList.add("expanded");
  if (arrow && !arrow.classList.contains("json-arrow-empty")) {
    arrow.textContent = "▼";
  }
  head.setAttribute("aria-expanded", "true");
  if (preview) preview.hidden = true;
  if (openBrace) openBrace.hidden = false;
  if (children) children.hidden = false;
  if (closeLine) closeLine.hidden = false;
}

function renderNode(
  key: string | null,
  value: unknown,
  depth: number,
  expandDepth: number,
  isRoot: boolean,
): HTMLElement {
  const type = valueType(value);

  if (type === "object" || type === "array") {
    return renderCollection(key, value as object | unknown[], depth, expandDepth, isRoot, type);
  }

  return renderLeaf(key, value, type);
}

function renderCollection(
  key: string | null,
  value: object | unknown[],
  depth: number,
  expandDepth: number,
  isRoot: boolean,
  type: "object" | "array",
): HTMLElement {
  const entries =
    type === "array"
      ? (value as unknown[]).map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);

  const expanded = depth < expandDepth;
  const row = document.createElement("div");
  row.className = "json-node json-collection" + (expanded ? " expanded" : "");
  row.dataset.searchText = key ?? (type === "array" ? "array" : "object");

  const head = document.createElement("div");
  head.className = "json-line json-toggle-line";
  head.tabIndex = 0;
  head.setAttribute("role", "button");
  head.setAttribute("aria-expanded", expanded ? "true" : "false");

  const arrow = document.createElement("span");
  arrow.className = "json-arrow";
  arrow.textContent = expanded ? "▼" : "▶";

  if (key !== null) {
    const keyEl = document.createElement("span");
    keyEl.className = "json-key";
    keyEl.textContent = key;
    head.appendChild(arrow);
    head.appendChild(keyEl);
    head.appendChild(document.createTextNode(": "));
  } else {
    head.appendChild(arrow);
  }

  const preview = document.createElement("span");
  preview.className = "json-preview";
  preview.textContent = collapsedPreview(type, entries.length);
  if (expanded) preview.hidden = true;

  const openBrace = document.createElement("span");
  openBrace.className = "json-brace";
  openBrace.textContent = type === "array" ? "[" : "{";
  openBrace.hidden = !expanded;

  head.appendChild(preview);
  head.appendChild(openBrace);

  if (!isRoot && entries.length === 0) {
    preview.hidden = true;
    openBrace.hidden = false;
    const closeInline = document.createElement("span");
    closeInline.className = "json-brace";
    closeInline.textContent = type === "array" ? "]" : "}";
    head.appendChild(closeInline);
    arrow.textContent = "";
    arrow.classList.add("json-arrow-empty");
    row.appendChild(head);
    return row;
  }

  const children = document.createElement("div");
  children.className = "json-children";
  children.hidden = !expanded;

  for (const [k, v] of entries) {
    children.appendChild(renderNode(k, v, depth + 1, expandDepth, false));
  }

  const closeLine = document.createElement("div");
  closeLine.className = "json-line json-close";
  const closeBrace = document.createElement("span");
  closeBrace.className = "json-brace";
  closeBrace.textContent = type === "array" ? "]" : "}";
  closeLine.appendChild(closeBrace);
  closeLine.hidden = !expanded;

  const toggle = () => {
    const next = !row.classList.contains("expanded");
    row.classList.toggle("expanded", next);
    arrow.textContent = next ? "▼" : "▶";
    head.setAttribute("aria-expanded", next ? "true" : "false");
    preview.hidden = next;
    openBrace.hidden = !next;
    children.hidden = !next;
    closeLine.hidden = !next;
  };

  head.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
  head.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });

  row.appendChild(head);
  row.appendChild(children);
  row.appendChild(closeLine);
  return row;
}

function renderLeaf(key: string | null, value: unknown, type: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "json-node json-leaf";

  const formatted = formatPrimitive(value, type);
  row.dataset.searchText = [key, formatted].filter(Boolean).join(" ");

  const line = document.createElement("div");
  line.className = "json-line";

  const spacer = document.createElement("span");
  spacer.className = "json-arrow json-arrow-empty";
  line.appendChild(spacer);

  if (key !== null) {
    const keyEl = document.createElement("span");
    keyEl.className = "json-key";
    keyEl.textContent = key;
    line.appendChild(keyEl);
    line.appendChild(document.createTextNode(": "));
  }

  const valEl = document.createElement("span");
  valEl.className = `json-value json-${type}`;
  valEl.textContent = formatted;
  line.appendChild(valEl);

  row.appendChild(line);
  return row;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function collapsedPreview(type: "object" | "array", count: number): string {
  if (type === "array") {
    return count === 0 ? "[]" : `Array(${count})`;
  }
  return count === 0 ? "{}" : `{…} (${count})`;
}

function formatPrimitive(value: unknown, type: string): string {
  switch (type) {
    case "string":
      return JSON.stringify(value);
    case "number":
    case "boolean":
    case "null":
      return String(value);
    default:
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
  }
}
