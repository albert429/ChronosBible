import { lazy, Suspense, type ComponentType } from "react";
import { chapterVerse, isolate } from "../bible/reference";
import { isBibleChapter, type ScriptureReading } from "../bible/types";
import { ChunkBoundary, Loading } from "../components/Feedback";
import Sheet from "../components/Sheet";
import { verseNumberButton } from "../reader/scriptureDom";
import { displayArabic } from "../lib/arabicDisplay";
import { useDiacritics } from "../navigation/appearance";
import type { VerseActionsProps } from "./VerseActions";
import type { StudyTarget } from "./load";

const StudyPanel = lazy(() => import("./StudyPanel"));
// Copy and share are a convenience: if their chunk fails, nothing shows.
const VerseActions = lazy<ComponentType<VerseActionsProps>>(() =>
  import("./VerseActions").catch(() => ({ default: () => null })),
);

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
  const diacritics = useDiacritics();
  const passage = reading.passages[target.passage];
  const verse = passage?.verses?.find((v) => v.number === target.verse);
  if (!passage || !verse) return null;
  const text = displayArabic(verse.text, diacritics);
  // Isolate chapter:verse so it keeps its order inside the Arabic title.
  const reference = `${passage.book} ${isolate(chapterVerse(passage.chapter, verse.number))}`;
  return (
    <Sheet
      open={open}
      title={reference}
      keepsAudio
      onClose={onClose}
      onAfterClose={onAfterClose}
      returnFocusTo={verseNumberButton(target.el)}
    >
      <p className="study-verse">{text}</p>
      <div className="verse-actions-slot">
        <Suspense fallback={null}>
          <VerseActions
            book={passage.book}
            chapter={passage.chapter}
            verse={verse.number}
            text={text}
            reference={reference}
          />
        </Suspense>
      </div>
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
