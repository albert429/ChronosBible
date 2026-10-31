/** The scripture markup that the reader, audio player and navigation share. */

const PASSAGE_PREFIX = "passage-";

export const passageId = (index: number) => `${PASSAGE_PREFIX}${index}`;
export const passageHeadingId = (index: number) =>
  `${PASSAGE_PREFIX}heading-${index}`;

export const passageElement = (index: number) =>
  document.getElementById(passageId(index));

export const verseElement = (passage: number, verse: number) =>
  document.querySelector<HTMLElement>(
    `#${passageId(passage)} .verse[data-v="${verse}"]`,
  );

export const verseNumberButton = (verseEl: HTMLElement) =>
  verseEl.querySelector<HTMLElement>(".verse-number");

export const closestVerse = (node: EventTarget | null) =>
  (node as Element).closest<HTMLElement>(".verse");

export const isVerseNumber = (node: EventTarget | null) =>
  !!(node as Element).closest(".verse-number");

/** The passage index and verse number a verse element renders. */
export function verseLocation(verseEl: HTMLElement) {
  const section = verseEl.closest("section.passage");
  const passage = Number(section?.id.replace(PASSAGE_PREFIX, ""));
  const verse = Number(verseEl.dataset.v);
  if (!section || !Number.isInteger(passage) || !Number.isInteger(verse))
    return null;
  return { passage, verse };
}

export const markSelected = (verseEl: HTMLElement) => {
  verseEl.dataset.selected = "";
};
export const clearSelected = (verseEl: HTMLElement) => {
  delete verseEl.dataset.selected;
};
export const markListening = (verseEl: HTMLElement) => {
  verseEl.dataset.listening = "";
};
export const clearListening = (verseEl: HTMLElement) => {
  delete verseEl.dataset.listening;
};

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
