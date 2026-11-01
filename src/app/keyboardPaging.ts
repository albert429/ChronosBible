/** The parts of a key press that decide paging. */
export type PagingKey = Pick<
  KeyboardEvent,
  "key" | "defaultPrevented" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
> & { target: EventTarget | null };

/** Typing and choosing keep their arrow keys. */
const EDITABLE = "input, select, textarea, [contenteditable]";

/**
 * Where an arrow key pages, like the toolbar's chevrons: in a right-to-left
 * book the next reading is on the left. Nothing pages away from the
 * reading, with a modifier, from a field, or while any dialog is open.
 */
export function pagingTarget<T>(
  event: PagingKey,
  {
    reading,
    previous,
    next,
    dialogOpen,
  }: {
    /** Whether the reading is on screen (not the plan calendar). */
    reading: boolean;
    previous?: T;
    next?: T;
    dialogOpen: () => boolean;
  },
): T | undefined {
  const target =
    event.key === "ArrowLeft"
      ? next
      : event.key === "ArrowRight"
        ? previous
        : undefined;
  if (
    !target ||
    !reading ||
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    (event.target as Element | null)?.closest?.(EDITABLE) ||
    dialogOpen()
  )
    return;
  return target;
}
