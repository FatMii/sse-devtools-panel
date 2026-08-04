/** Shared panel icons: one viewBox, one stroke convention. */

export const ICON_VIEWBOX = "0 0 24 24";
export const ICON_STROKE_WIDTH = "2";

/**
 * Inner SVG markup only (paths / circles).
 * Default rendering is outline (stroke=currentColor, fill=none).
 * Use fill="currentColor" stroke="none" on shapes that should be solid.
 */
const ICONS = {
  import: `<path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/>`,
  export: `<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>`,
  caret: `<path d="m6 9 6 6 6-6"/>`,
  save: `<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>`,
  archives: `<circle cx="15" cy="19" r="2"/><path d="M20.9 19.8A2 2 0 0 0 22 18V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h5.1"/><path d="M15 11v-1"/><path d="M15 17v-2"/>`,
  stats: `<path d="M13 17V9"/><path d="M18 17V5"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 17v-3"/>`,
  pause: `<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>`,
  clear: `<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  settings: `<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>`,
  more: `<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>`,
  search: `<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>`,
  prev: `<path d="m15 18-6-6 6-6"/>`,
  next: `<path d="m9 18 6-6-6-6"/>`,
  copy: `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
  close: `<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>`,
} as const;

export type IconName = keyof typeof ICONS;

export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/** Build a complete SVG element string. */
export function renderIcon(name: IconName, className = "tool-icon"): string {
  const classes = className.trim() || "tool-icon";
  return (
    `<svg class="${classes}" viewBox="${ICON_VIEWBOX}" fill="none" stroke="currentColor" ` +
    `stroke-width="${ICON_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    ICONS[name] +
    `</svg>`
  );
}

/**
 * Replace `[data-icon="name"]` placeholders with shared SVG markup.
 * Keeps the placeholder's `class` on the generated `<svg>`.
 */
export function applyIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
    const name = el.getAttribute("data-icon");
    if (!name || !isIconName(name)) {
      console.warn(`[icons] unknown data-icon="${name ?? ""}"`);
      return;
    }
    const className = el.getAttribute("class") ?? "tool-icon";
    el.outerHTML = renderIcon(name, className);
  });
}
