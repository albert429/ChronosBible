import { lazy, Suspense, type ComponentType } from "react";
import { chapterVerse, isolate } from "../../domain/scripture/reference";
import { ChunkBoundary, Loading } from "../../shared/ui/Feedback";
import Sheet from "../../shared/ui/Sheet";
import { verseNumberButton } from "../../shared/browser/scriptureDom";
import { displayArabic } from "../../shared/lib/arabicDisplay";
import { useDiacritics } from "../appearance/appearance";
import type { VerseActionsProps } from "./VerseActions";
import type { StudyContext } from "./load";

const StudyPanel = lazy(() => import("./StudyPanel"));
// Copy and share are a convenience: if their chunk fails, nothing shows.
const VerseActions = lazy<ComponentType<VerseActionsProps>>(() =>
  import("./VerseActions").catch(() => ({ default: () => null })),
);

export default function VerseStudy({
  open,
  context: { usfm, passage, verse },
  returnFocusTo,
  onClose,
  onAfterClose,
}: {
  open: boolean;
  context: StudyContext;
  /** The tapped verse's element; focus returns to its number. */
  returnFocusTo: HTMLElement;
  onClose: () => void;
  onAfterClose: () => void;
}) {
  const diacritics = useDiacritics();
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
      returnFocusTo={verseNumberButton(returnFocusTo)}
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
          <StudyPanel usfm={usfm} passage={passage} verse={verse} />
        </Suspense>
      </ChunkBoundary>
    </Sheet>
  );
}
