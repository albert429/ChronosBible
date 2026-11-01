/** Scroll the sheet just enough to show an opened section, keeping its heading visible. */
export function reveal(section: HTMLElement) {
  const scroller = section.closest(".sheet-body");
  if (!scroller) return;
  const view = scroller.getBoundingClientRect();
  const box = section.getBoundingClientRect();
  const delta = Math.min(box.bottom - view.bottom + 12, box.top - view.top - 8);
  if (delta > 0)
    scroller.scrollBy({
      top: delta,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
}
