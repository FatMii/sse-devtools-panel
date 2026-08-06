/** Events table column resize (not persisted). */

const MIN_COL_WIDTH = 40;

export type EventsColId = "index" | "time" | "event" | "data";

const DEFAULT_WIDTHS: Record<EventsColId, number> = {
  index: 48,
  time: 110,
  event: 90,
  data: 280,
};

export function initEventsColumnResizers(table: HTMLTableElement): void {
  for (const [col, width] of Object.entries(DEFAULT_WIDTHS) as Array<[EventsColId, number]>) {
    table.style.setProperty(`--col-${col}-width`, `${width}px`);
  }

  const handles = table.querySelectorAll<HTMLElement>(".col-resizer");
  handles.forEach((handle) => {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const col = handle.dataset.col as EventsColId | undefined;
      if (!col || !(col in DEFAULT_WIDTHS)) return;

      const startX = e.pageX;
      const startWidth =
        parseFloat(getComputedStyle(table).getPropertyValue(`--col-${col}-width`)) ||
        DEFAULT_WIDTHS[col];

      handle.classList.add("resizing");
      document.body.classList.add("is-col-resizing");

      const onMove = (ev: MouseEvent) => {
        const next = Math.max(MIN_COL_WIDTH, startWidth + (ev.pageX - startX));
        table.style.setProperty(`--col-${col}-width`, `${next}px`);
      };

      const onUp = () => {
        handle.classList.remove("resizing");
        document.body.classList.remove("is-col-resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
}
