import { lazy, Suspense } from "react";
import { chapterVerse, isolate } from "../bible/reference";
import { isBibleChapter, type ScriptureReading } from "../bible/types";
import { ChunkBoundary, Loading } from "../components/Feedback";
import Sheet from "../components/Sheet";
import { displayArabic } from "../lib/arabicDisplay";
import { useAppearance } from "../navigation/appearance";
import { verseNumberButton } from "../reader/scriptureDom";

export const loadStudyPanel = () => import("./StudyPanel");
const StudyPanel = lazy(loadStudyPanel);

export type StudyTarget = { passage: number; verse: number; el: HTMLElement };

export default function VerseStudy({
  open,
  reading,
  target,
  onClose,
  onAfterClose,
}: {
  open: boolean;
  reading: ScriptureReading;
  target: StudyTarget;
  onClose: () => void;
  onAfterClose: () => void;
}) {
  const { diacritics } = useAppearance();
  const passage = reading.passages[target.passage];
  const verse = passage?.verses?.find((v) => v.number === target.verse);
  if (!passage || !verse) return null;
  return (
    <Sheet
      open={open}
      // Isolate chapter:verse so it keeps its order inside the Arabic title.
      title={`${passage.book} ${isolate(chapterVerse(passage.chapter, verse.number))}`}
      onClose={onClose}
      onAfterClose={onAfterClose}
      returnFocusTo={verseNumberButton(target.el)}
    >
      <p className="study-verse">{displayArabic(verse.text, diacritics)}</p>
      <ChunkBoundary>
        <Suspense fallback={<Loading label="جارٍ تحميل دراسة الآية…" />}>
          <StudyPanel
            usfm={isBibleChapter(reading) ? reading.usfm : undefined}
            passage={passage}
            verse={verse}
          />
        </Suspense>
      </ChunkBoundary>
    </Sheet>
  );
}
