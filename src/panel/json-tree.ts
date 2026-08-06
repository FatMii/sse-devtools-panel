import { compileTextFilter } from "../shared/text-filter";

/**
 * Build an expandable JSON tree.
 */

export function tryParseJsonValue(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false };

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    // continue
  }

  // NDJSON: parse each line and wrap as an array
  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    try {
      return { ok: true, value: lines.map((l) => JSON.parse(l)) };
    } catch {
      return { ok: false };
    }
  }

  return { ok: false };
}

export function createJsonTree(
  value: unknown,
  options?: { defaultExpandDepth?: number },
): HTMLElement {
  const depth = options?.defaultExpandDepth ?? 1;
  const root = document.createElement("div");
  root.className = "json-tree";
  root.appendChild(renderNode(null, value, 0, depth, true, true, "$"));
  const firstFocusable = root.querySelector<HTMLElement>(".json-focusable");
  if (firstFocusable) {
    setActiveLine(firstFocusable);
  }
  return root;
}

type JsonTreeContextMenuDetail = {
  x: number;
  y: number;
  path: string;
  copyValue?: string;
};

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
  const headComma = head.querySelector<HTMLElement>(".json-comma");

  row.classList.add("expanded");
  if (arrow && !arrow.classList.contains("json-arrow-empty")) {
    arrow.textContent = "▼";
  }
  head.setAttribute("aria-expanded", "true");
  if (preview) preview.hidden = true;
  if (openBrace) openBrace.hidden = false;
  if (children) children.hidden = false;
  if (closeLine) closeLine.hidden = false;
  if (headComma) {
    headComma.hidden = true;
  }
}

function renderNode(
  key: string | null,
  value: unknown,
  depth: number,
  expandDepth: number,
  isRoot: boolean,
  isLast: boolean,
  path: string,
): HTMLElement {
  const type = valueType(value);

  if (type === "object" || type === "array") {
    return renderCollection(
      key,
      value as object | unknown[],
      depth,
      expandDepth,
      isRoot,
      type,
      isLast,
      path,
    );
  }

  return renderLeaf(key, value, type, path);
}

function renderCollection(
  key: string | null,
  value: object | unknown[],
  depth: number,
  expandDepth: number,
  isRoot: boolean,
  type: "object" | "array",
  isLast: boolean,
  path: string,
): HTMLElement {
  const entries =
    type === "array"
      ? (value as unknown[]).map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);

  const expanded = depth < expandDepth;
  const row = document.createElement("div");
  row.className = "json-node json-collection" + (expanded ? " expanded" : "");
  row.dataset.searchText = [path, key ?? (type === "array" ? "array" : "object")]
    .filter(Boolean)
    .join(" ");
  row.dataset.path = path;

  const head = document.createElement("div");
  head.className = "json-line json-toggle-line json-focusable";
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
    if (!isLast) {
      const comma = document.createElement("span");
      comma.className = "json-comma";
      comma.textContent = ",";
      head.appendChild(comma);
    }
    arrow.textContent = "";
    arrow.classList.add("json-arrow-empty");
    row.appendChild(head);
    return row;
  }

  const children = document.createElement("div");
  children.className = "json-children";
  children.hidden = !expanded;

  for (let i = 0; i < entries.length; i += 1) {
    const [k, v] = entries[i];
    children.appendChild(
      renderNode(
        k,
        v,
        depth + 1,
        expandDepth,
        false,
        i === entries.length - 1,
        buildChildPath(path, k, type),
      ),
    );
  }

  const closeLine = document.createElement("div");
  closeLine.className = "json-line json-close";
  const closeBrace = document.createElement("span");
  closeBrace.className = "json-brace";
  closeBrace.textContent = type === "array" ? "]" : "}";
  closeLine.appendChild(closeBrace);
  const closeComma = document.createElement("span");
  closeComma.className = "json-comma";
  closeComma.textContent = ",";
  closeComma.hidden = isLast;
  closeLine.appendChild(closeComma);
  closeLine.hidden = !expanded;

  const headComma = document.createElement("span");
  headComma.className = "json-comma";
  headComma.textContent = ",";
  headComma.dataset.isLast = isLast ? "1" : "0";
  headComma.hidden = expanded || isLast;
  head.appendChild(headComma);

  const toggle = () => {
    const next = !row.classList.contains("expanded");
    row.classList.toggle("expanded", next);
    arrow.textContent = next ? "▼" : "▶";
    head.setAttribute("aria-expanded", next ? "true" : "false");
    preview.hidden = next;
    openBrace.hidden = !next;
    children.hidden = !next;
    closeLine.hidden = !next;
    headComma.hidden = next || isLast;
  };

  head.addEventListener("click", (e) => {
    e.stopPropagation();
    setActiveLine(head);
    toggle();
  });
  head.addEventListener("focus", () => {
    setActiveLine(head);
  });
  head.addEventListener("keydown", (e) => {
    if (handleTreeNavigationKey(e, head, row)) {
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
  head.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dispatchJsonTreeContextMenu(head, {
      x: e.clientX,
      y: e.clientY,
      path,
    });
  });

  row.appendChild(head);
  row.appendChild(children);
  row.appendChild(closeLine);
  return row;
}

function renderLeaf(key: string | null, value: unknown, type: string, path: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "json-node json-leaf";
  row.dataset.path = path;

  const formatted = formatPrimitive(value, type);
  row.dataset.searchText = [path, key, formatted].filter(Boolean).join(" ");

  const line = document.createElement("div");
  line.className = "json-line json-focusable";
  line.tabIndex = 0;

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

  line.addEventListener("click", () => {
    setActiveLine(line);
  });
  line.addEventListener("focus", () => {
    setActiveLine(line);
  });
  line.addEventListener("keydown", (e) => {
    handleTreeNavigationKey(e, line);
  });
  line.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dispatchJsonTreeContextMenu(line, {
      x: e.clientX,
      y: e.clientY,
      path,
      copyValue: toCopyValue(value, type),
    });
  });

  row.appendChild(line);
  return row;
}

function toCopyValue(value: unknown, type: string): string {
  if (type === "string") return String(value);
  if (type === "number" || type === "boolean" || type === "null") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildChildPath(parentPath: string, key: string, parentType: "object" | "array"): string {
  if (parentType === "array") {
    return `${parentPath}[${key}]`;
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return `${parentPath}.${key}`;
  }
  return `${parentPath}[${JSON.stringify(key)}]`;
}

function handleTreeNavigationKey(
  e: KeyboardEvent,
  current: HTMLElement,
  currentCollectionRow?: HTMLElement,
): boolean {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    focusSibling(current, 1);
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    focusSibling(current, -1);
    return true;
  }

  if (e.key === "ArrowRight" && currentCollectionRow) {
    if (!currentCollectionRow.classList.contains("expanded")) {
      e.preventDefault();
      current.click();
      return true;
    }
    const childHead = currentCollectionRow.querySelector<HTMLElement>(
      ":scope > .json-children > .json-node > .json-focusable",
    );
    if (childHead) {
      e.preventDefault();
      childHead.focus();
      return true;
    }
  }

  if (e.key === "ArrowLeft") {
    if (currentCollectionRow?.classList.contains("expanded")) {
      e.preventDefault();
      current.click();
      return true;
    }
    const node = current.closest<HTMLElement>(".json-node");
    const parentNode = node?.parentElement?.closest<HTMLElement>(".json-node.json-collection");
    const parentHead = parentNode?.querySelector<HTMLElement>(":scope > .json-toggle-line");
    if (parentHead) {
      e.preventDefault();
      parentHead.focus();
      return true;
    }
  }
  return false;
}

function focusSibling(current: HTMLElement, delta: 1 | -1): void {
  const root = current.closest<HTMLElement>(".json-tree");
  if (!root) return;
  const focusables = Array.from(root.querySelectorAll<HTMLElement>(".json-focusable")).filter(
    isElementVisible,
  );
  const idx = focusables.indexOf(current);
  if (idx < 0) return;
  const next = focusables[idx + delta];
  if (next) next.focus();
}

function isElementVisible(el: HTMLElement): boolean {
  return !el.hidden && el.getClientRects().length > 0;
}

function setActiveLine(line: HTMLElement): void {
  const root = line.closest<HTMLElement>(".json-tree");
  if (!root) return;
  root.querySelectorAll<HTMLElement>(".json-line.is-active").forEach((node) => {
    node.classList.remove("is-active");
  });
  line.classList.add("is-active");
}

function dispatchJsonTreeContextMenu(target: HTMLElement, detail: JsonTreeContextMenuDetail): void {
  target.dispatchEvent(
    new CustomEvent<JsonTreeContextMenuDetail>("json-tree-contextmenu", {
      bubbles: true,
      detail,
    }),
  );
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
