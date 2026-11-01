import { BookOpen } from "lucide-react";
import { Loading, LoadError } from "../../shared/ui/Feedback";
import { verseTranslations } from "../../data/study/client";
import { displayArabic } from "../../shared/lib/arabicDisplay";
import { useAppearance } from "../appearance/appearance";
import { studyReference } from "../../domain/study/reference";
import type { VerseText } from "../../domain/study/types";
import { useResource } from "../../shared/hooks/useResource";
import Section from "./Section";

const textOf = (value: VerseText) =>
  typeof value === "string" ? value : value.t;

function Translations({ id }: { id: string }) {
  const tr = useResource(verseTranslations, id);
  const { diacritics } = useAppearance();
  if (tr.error) return <LoadError message={tr.error} retry={tr.retry} />;
  if (!tr.data) return <Loading label="جارٍ تحميل الترجمات…" />;
  const { n, e } = tr.data.verses[studyReference(id).verse] ?? {};
  if (!n && !e)
    return <p className="study-empty">لا تتوفر ترجمات أخرى لهذه الآية.</p>;
  return (
    <>
      {n && (
        <div className="study-translation">
          <p className="study-tag">
            كتاب الحياة
            {typeof n === "object" && (
              <>
                {" "}
                (الآيات <bdi dir="ltr">{n.b}</bdi>)
              </>
            )}
          </p>
          <p className="study-translation-text">
            {displayArabic(textOf(n), diacritics)}
          </p>
        </div>
      )}
      {e && (
        <div className="study-translation">
          <p className="study-tag">
            الإنجليزية (KJV)
            {typeof e === "object" && (
              <>
                {" "}
                (الآيات <bdi dir="ltr">{e.b}</bdi>)
              </>
            )}
          </p>
          <p className="study-english" lang="en" dir="ltr">
            {textOf(e)}
          </p>
        </div>
      )}
    </>
  );
}

export default function OtherTranslation({ id }: { id: string }) {
  return (
    <Section
      title="ترجمات أخرى"
      hint="كتاب الحياة والإنجليزية (KJV)"
      icon={<BookOpen size={18} />}
    >
      <Translations id={id} />
    </Section>
  );
}
