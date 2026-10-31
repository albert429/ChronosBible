import { memo, Fragment, type Ref } from "react";
import { ar } from "../lib/format";
import { displayArabic } from "../lib/arabicDisplay";
import { useDiacritics } from "../navigation/appearance";
import {
  isBibleChapter,
  isChronologicalReading,
  type AnyScriptureReading,
  type BibleBlock,
} from "../bible/types";
import type { Passage } from "../plan/readings";
import ChapterText from "./ChapterText";
import PassageReference from "../components/PassageReference";
import ListenButton from "./ListenButton";
import { passageHeadingId, passageId } from "./scriptureDom";
import "./Scripture.css";

type Props = {
  reading: AnyScriptureReading;
  audio: boolean;
  listening: boolean;
  onToggleListen: () => void;
  listenButton: Ref<HTMLButtonElement>;
};

/** A chronological passage may carry its chapter's in-range source blocks. */
const passageStructure = (passage: Passage) =>
  (passage as Passage & { structure?: BibleBlock[] }).structure;

// Memoized: the listen toggle and other title-row changes skip the text.
const PlainVerses = memo(function PlainVerses({
  passage,
  diacritics,
}: {
  passage: Passage;
  diacritics: boolean;
}) {
  return (
    <div className="verse-text">
      {passage.verses?.map((verse) => (
        <Fragment key={verse.number}>
          {verse.heading && <h3>{displayArabic(verse.heading, diacritics)}</h3>}
          <span className="verse" data-v={verse.number}>
            <sup>
              <button
                type="button"
                className="verse-number"
                aria-haspopup="dialog"
                aria-label={`تفاصيل الآية ${ar(verse.number)}`}
              >
                {ar(verse.number)}
              </button>
            </sup>
            {displayArabic(verse.text, diacritics)}{" "}
          </span>
        </Fragment>
      ))}
    </div>
  );
});

export default memo(function Scripture({
  reading,
  audio,
  listening,
  onToggleListen,
  listenButton,
}: Props) {
  const diacritics = useDiacritics();
  const chapter = isBibleChapter(reading);
  const chronological = isChronologicalReading(reading);
  return (
    <div className="scripture">
      {reading.passages.map((passage, index) => {
        const structure = chapter
          ? reading.structure
          : chronological
            ? passageStructure(passage)
            : undefined;
        return (
          <section
            className="passage"
            id={passageId(index)}
            aria-labelledby={passageHeadingId(index)}
            tabIndex={-1}
            key={index}
          >
            <div className="passage-title-row">
              <h2 id={passageHeadingId(index)}>
                {passage.book} <PassageReference passage={passage} />
              </h2>
              {index === 0 && audio && (
                <ListenButton
                  ref={listenButton}
                  label={
                    chapter
                      ? "استمع إلى الإصحاح"
                      : chronological
                        ? "استمع إلى القراءة"
                        : undefined
                  }
                  listening={listening}
                  onToggle={onToggleListen}
                />
              )}
            </div>
            {index === 0 && !audio && (chapter || chronological) && (
              <p className="audio-unavailable">
                {chapter
                  ? "التسجيل الصوتي غير متاح لهذا الإصحاح حاليًا."
                  : "التسجيل الصوتي غير متاح لهذه القراءة حاليًا."}
              </p>
            )}
            {structure ? (
              <ChapterText
                verses={passage.verses}
                structure={structure}
                diacritics={diacritics}
              />
            ) : (
              <PlainVerses passage={passage} diacritics={diacritics} />
            )}
          </section>
        );
      })}
    </div>
  );
});
