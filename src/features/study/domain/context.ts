import type { Passage, Verse } from "../../../core/scripture/types.ts";

/**
 * The canonical verse to study and the passage it was read in, in any track
 * (built by the reader, src/features/reader/studyContext.ts). `usfm` is its
 * book's code; focus elements stay with the reader.
 */
export type StudyContext = { usfm?: string; passage: Passage; verse: Verse };
