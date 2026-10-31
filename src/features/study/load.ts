/**
 * The verse study sheet loads apart from the reader. The first press on the
 * text warms its code (src/reader/useVerseTap.ts); data loads on opening.
 */
export type StudyTarget = { passage: number; verse: number; el: HTMLElement };

export const loadVerseStudy = () => import("./VerseStudy");

export const loadStudyPanel = () =>
  Promise.all([
    loadVerseStudy(),
    import("./StudyPanel"),
    import("./VerseActions"),
  ]);
