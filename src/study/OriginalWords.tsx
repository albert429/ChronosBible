import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { Loading, LoadError } from "../components/Feedback";
import { useResource } from "../lib/useResource";
import { displayArabic } from "../lib/arabicDisplay";
import { useAppearance } from "../navigation/appearance";
import { verseWords } from "./canonicalClient";
import { gloss, originalWord, span, wordGroups, wordsTitle } from "./verse";
import type { WordToken } from "./types";
import Section from "./Section";

function Words({
  id,
  text,
  onWords,
}: {
  id: string;
  text: string;
  onWords: (words: WordToken[]) => void;
}) {
  const loaded = useResource(verseWords, id);
  const { diacritics } = useAppearance();
  const words = loaded.data?.verses[id.split(".")[2]]?.w;
  useEffect(() => {
    if (words) onWords(words);
  }, [words, onWords]);
  if (loaded.error)
    return <LoadError message={loaded.error} retry={loaded.retry} />;
  if (!loaded.data) return <Loading label="جارٍ تحميل الكلمات الأصلية…" />;
  const groups = wordGroups(words ?? []);
  if (!groups.length)
    return <p className="study-empty">لا تتوفر كلمات أصلية لهذه الآية.</p>;
  return (
    <ul className="greek-list">
      {groups.map((group, index) => (
        <li className="greek-row" key={index}>
          <div className="greek-main">
            {group.a0 !== null &&
              group.a1 !== null &&
              group.a1 < text.split(" ").length && (
                <>
                  <span className="greek-ar">
                    {displayArabic(span(text, group.a0, group.a1), diacritics)}
                  </span>
                  <span className="greek-arrow" aria-hidden="true">
                    ←
                  </span>
                </>
              )}
            {group.tokens.map((word, i) => (
              <bdi
                key={i}
                lang={word[7]}
                dir={word[7] === "grc" ? "ltr" : "rtl"}
                className="greek-word"
              >
                {originalWord(word)}
              </bdi>
            ))}
            <span className="greek-arrow" aria-hidden="true">
              ←
            </span>
            <bdi lang="en" dir="ltr" className="greek-en">
              {group.tokens.map((word) => gloss(word[4])).join(" · ")}
            </bdi>
          </div>
          <bdi lang="en" dir="ltr" className="greek-meta">
            {group.tokens.map((word) => word[1]).join(" ")}
            {" · "}
            <span className="study-strong" aria-label="Strong’s">
              {group.tokens.map((word) => word[2]).join(" · ")}
            </span>
          </bdi>
        </li>
      ))}
    </ul>
  );
}

export default function OriginalWords({
  id,
  text,
  oldTestament,
}: {
  id: string;
  text: string;
  oldTestament: boolean;
}) {
  const [words, setWords] = useState<WordToken[]>([]);
  return (
    <Section
      title={wordsTitle(words, oldTestament)}
      hint="الكلمة العربية ومقابلها في الأصل"
      icon={<Languages size={18} />}
      count={words.length ? wordGroups(words).length : undefined}
    >
      <Words id={id} text={text} onWords={setWords} />
    </Section>
  );
}
