import { verseLocation } from "../../shared/browser/scriptureDom";

/** The bottom edge of the sticky toolbar, which grows with large text. */
export const toolbarBottom = () =>
  document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;

/**
 * Scrolls a verse to just below the toolbar, or, with an offset (thousandths
 * of its height), that point of a verse that flows over several lines.
 */
export function scrollToVerse(verseEl: HTMLElement, offset?: number) {
  const box = verseEl.getBoundingClientRect();
  const top =
    offset === undefined
      ? box.top - 16
      : box.top + (box.height * offset) / 1000 - 1;
  window.scrollTo({
    top: Math.max(0, top + window.scrollY - toolbarBottom()),
    behavior: "instant",
  });
}

/**
 * The first verse not hidden under the toolbar in the reading `identity`
 * renders: undefined at its start, null while that text is not on screen.
 * Verses are in reading order, so a binary search reads a few layout boxes.
 */
export function topVisibleVerse(identity: string) {
  const reader = document.querySelector<HTMLElement>(".reader");
  if (reader?.dataset.reading !== identity) return null;
  const verses = reader.querySelectorAll<HTMLElement>(".verse");
  if (!verses.length) return null;
  const edge = toolbarBottom() + 1;
  let low = 0;
  let high = verses.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (verses[middle].getBoundingClientRect().bottom > edge) high = middle;
    else low = middle + 1;
  }
  const location = low > 0 ? verseLocation(verses[low]) : null;
  if (!location) return;
  // Verses flow inline: the top line may be the end of a longer verse.
  const box = verses[low].getBoundingClientRect();
  const offset = Math.round(((edge - box.top) / box.height) * 1000);
  return { ...location, offset: Math.max(0, Math.min(1000, offset)) };
}
