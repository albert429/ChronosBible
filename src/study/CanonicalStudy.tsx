import { catalog } from "../bible/catalog";
import { findBibleBook } from "../bible/navigation";
import type { BibleChapter } from "../bible/types";
import { Loading, LoadError } from "../components/Feedback";
import { useResource } from "../lib/useResource";
import { planIndex, type Verse } from "../plan/readings";
import StudyPanel from "./StudyPanel";

export default function CanonicalStudy({
  reading,
  verse,
}: {
  reading: BibleChapter;
  verse: Verse;
}) {
  const available = findBibleBook(catalog, reading.usfm)?.testament === "NT";
  const index = useResource(planIndex, "plan", available);
  if (!available)
    return <p className="study-empty">لا تتوفر دراسة لهذه الآية حاليًا.</p>;
  if (index.error)
    return <LoadError message={index.error} retry={index.retry} />;
  if (!index.data) return <Loading label="جارٍ تحميل دراسة الآية…" />;
  for (const day of index.data) {
    const passageIndex = day.passages.findIndex(
      (passage) =>
        passage.book === reading.book &&
        passage.chapter === reading.chapter &&
        verse.number >= passage.start &&
        verse.number <= passage.end,
    );
    if (passageIndex >= 0)
      return (
        <StudyPanel
          day={day.day}
          passageIndex={passageIndex}
          passage={reading.passages[0]}
          verse={verse}
        />
      );
  }
  return <p className="study-empty">لا تتوفر دراسة لهذه الآية حاليًا.</p>;
}
