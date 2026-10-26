import "./study.css";
import { lazy, Suspense } from "react";
import { catalog } from "../bible/catalog";
import { ChunkBoundary, Loading } from "../components/Feedback";
import type { Passage, Verse } from "../plan/readings";
import OriginalWords from "./OriginalWords";
import AiSpark from "./AiSpark";
import OtherTranslation from "./OtherTranslation";
import Section from "./Section";
import { verseId } from "../bible/verse";

// The disabled production build never includes the AI provider or panel chunks.
const AiPanel = __AI_ENABLED__ ? lazy(() => import("./AiPanel")) : null;

export default function StudyPanel({
  passage,
  verse,
  usfm,
}: {
  passage: Passage;
  verse: Verse;
  usfm?: string;
}) {
  const book = catalog.find((item) =>
    usfm ? item.usfm === usfm : item.name === passage.book,
  );
  if (!book) return <p className="study-empty">لا تتوفر دراسة لهذه الآية.</p>;
  const id = verseId(book.usfm, passage.chapter, verse.number);
  return (
    <div className="study">
      <div className="study-sections" key={id}>
        <OtherTranslation id={id} />
        {AiPanel && (
          <Section
            title="اسأل الذكاء الاصطناعي"
            hint="شرح الآية وخلفيتها ومعاني كلماتها، أو سؤالك"
            icon={<AiSpark />}
          >
            <ChunkBoundary>
              <Suspense fallback={<Loading label="جارٍ التحميل…" />}>
                <AiPanel id={id} passage={passage} verse={verse} />
              </Suspense>
            </ChunkBoundary>
          </Section>
        )}
        <OriginalWords
          id={id}
          text={verse.text}
          oldTestament={book.testament === "OT"}
        />
      </div>
    </div>
  );
}
