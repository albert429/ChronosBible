import { catalog } from "../../domain/scripture/catalog.ts";
import {
  isBibleChapter,
  type ScriptureReading,
} from "../../domain/reading/types.ts";
import type { StudyContext } from "../study/load.ts";

/**
 * The canonical verse a tapped verse studies, in every track: the passage it
 * was read in, the verse, and its book's code. Study is addressed by
 * canonical reference, never by plan day or occurrence, so a chronological
 * passage needs no chapter of its own. Undefined when the reading does not
 * render that verse.
 */
export function studyContext(
  reading: ScriptureReading,
  passageIndex: number,
  verseNumber: number,
): StudyContext | undefined {
  const passage = reading.passages[passageIndex];
  const verse = passage?.verses?.find((item) => item.number === verseNumber);
  if (!passage || !verse) return;
  const usfm = isBibleChapter(reading)
    ? reading.usfm
    : catalog.find((book) => book.name === passage.book)?.usfm;
  return { usfm, passage, verse };
}
