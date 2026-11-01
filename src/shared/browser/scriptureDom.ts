/**
 * The Scripture markup the reader renders and the audio player, study sheet
 * and navigation query: passage and verse ids, lookups and marks.
 */

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
