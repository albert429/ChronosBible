/**
 * The verse study sheet loads apart from the reader. The first press on the
 * text warms its code (src/features/reader/useVerseTap.ts); data loads on opening.
 */
import type { Passage, Verse } from "../../domain/scripture/types.ts";

export type StudyTarget = { passage: number; verse: number; el: HTMLElement };
/**
 * The canonical verse to study and the passage it was read in, in any track
 * (built by the reader, src/features/reader/studyContext.ts). `usfm` is its
 * book's code; focus elements stay with the reader.
 */
export type StudyContext = { usfm?: string; passage: Passage; verse: Verse };

export const loadVerseStudy = () => import("./VerseStudy");

export const loadStudyPanel = () =>
  Promise.all([
    loadVerseStudy(),
    import("./StudyPanel"),
    import("./VerseActions"),
  ]);
