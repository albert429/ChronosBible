import { lazy, Suspense } from "react";
import { chapterVerse, isolate } from "../bible/reference";
import { isBibleChapter, type ScriptureReading } from "../bible/types";
import { ChunkBoundary, Loading } from "../components/Feedback";
import Sheet from "../components/Sheet";
import { verseNumberButton } from "../reader/scriptureDom";

export const loadStudyPanel = () => import("./StudyPanel");
const StudyPanel = lazy(loadStudyPanel);
const CanonicalStudy = lazy(() => import("./CanonicalStudy"));

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
      <p className="study-verse">{verse.text}</p>
      <ChunkBoundary>
        <Suspense fallback={<Loading label="جارٍ تحميل دراسة الآية…" />}>
          {isBibleChapter(reading) ? (
            <CanonicalStudy reading={reading} verse={verse} />
          ) : (
            <StudyPanel
              day={reading.day}
              passageIndex={target.passage}
              passage={passage}
              verse={verse}
            />
          )}
        </Suspense>
      </ChunkBoundary>
    </Sheet>
  );
}
