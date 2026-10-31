import { chapterRange, rangeAriaLabel } from "../../domain/scripture/reference";
import type { Passage } from "../../domain/scripture/types";
import "./PassageReference.css";

export default function PassageReference({ passage }: { passage: Passage }) {
  return (
    <bdi
      className="passage-reference"
      dir="ltr"
      aria-label={rangeAriaLabel(passage.chapter, passage)}
    >
      {chapterRange(passage.chapter, passage)}
    </bdi>
  );
}
