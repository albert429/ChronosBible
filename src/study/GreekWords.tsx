import { Languages } from "lucide-react";
import { gloss, greekWord, keyGroups, span } from "./verse";
import type { GreekToken } from "./types";
import Section from "./Section";
import { displayArabic } from "../lib/arabicDisplay";
import { useDiacritics } from "../navigation/appearance";

export default function GreekWords({
  text,
  g,
}: {
  text: string;
  g: GreekToken[];
}) {
  const diacritics = useDiacritics();
  const groups = keyGroups(g);
  if (!groups.length) return null;
  return (
    <Section
      title="الكلمات اليونانية"
      hint="الكلمة العربية ومقابلها في الأصل"
      icon={<Languages size={18} />}
      count={groups.length}
    >
      <ul className="greek-list">
        {groups.map((group, index) => (
          <li className="greek-row" key={index}>
            <div className="greek-main">
              {group.a0 !== null && group.a1 !== null && (
                <>
                  <span className="greek-ar">
                    {displayArabic(span(text, group.a0, group.a1), diacritics)}
                  </span>
                  <span className="greek-arrow" aria-hidden="true">
                    ←
                  </span>
                </>
              )}
              <bdi lang="grc" dir="ltr" className="greek-word">
                {group.tokens.map((t) => greekWord(t[0])).join(" ")}
              </bdi>
              <span className="greek-arrow" aria-hidden="true">
                ←
              </span>
              <bdi lang="en" dir="ltr" className="greek-en">
                {group.tokens.map((t) => gloss(t[4])).join(" · ")}
              </bdi>
            </div>
            <bdi dir="ltr" className="greek-meta">
              {group.tokens.map((t) => t[1]).join(" ")}
            </bdi>
          </li>
        ))}
      </ul>
    </Section>
  );
}
