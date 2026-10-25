import { useId, useState } from "react";
import { catalog } from "../bible/catalog";
import { findBibleBook } from "../bible/navigation";
import type { BibleLocation } from "../bible/types";
import { ar } from "../lib/format";
import { useProgress } from "../plan/useProgress";
import "./BiblePanel.css";

type Props = {
  location: BibleLocation;
  go: (location: BibleLocation) => void;
  close: (action?: () => void) => void;
};
export default function BiblePanel({ location, go, close }: Props) {
  const id = useId();
  const [code, setCode] = useState(location.book);
  const book = findBibleBook(catalog, code)!;
  const read = new Set(useProgress().completion.bible);
  function testament(next: "OT" | "NT") {
    if (book.testament !== next)
      setCode(catalog.find((item) => item.testament === next)!.usfm);
  }
  return (
    <div className="bible-picker">
      <div className="testament-options" role="group" aria-label="العهد">
        <button
          type="button"
          aria-pressed={book.testament === "OT"}
          onClick={() => testament("OT")}
        >
          العهد القديم
        </button>
        <button
          type="button"
          aria-pressed={book.testament === "NT"}
          onClick={() => testament("NT")}
        >
          العهد الجديد
        </button>
      </div>
      <label htmlFor={id}>السفر</label>
      <select
        id={id}
        value={code}
        onChange={(event) => setCode(event.target.value)}
      >
        {catalog
          .filter((item) => item.testament === book.testament)
          .map((item) => (
            <option value={item.usfm} key={item.usfm}>
              {item.name}
            </option>
          ))}
      </select>
      <h3>الإصحاح</h3>
      <div
        className="chapter-grid"
        role="group"
        aria-label={`إصحاحات ${book.name}`}
      >
        {Array.from({ length: book.chapters }, (_, index) => index + 1).map(
          (chapter) => (
            <button
              type="button"
              key={chapter}
              aria-label={`${book.name} ${ar(chapter)}`}
              aria-description={
                read.has(`${code}:${chapter}`) ? "مكتمل" : undefined
              }
              data-complete={read.has(`${code}:${chapter}`) || undefined}
              aria-current={
                code === location.book && chapter === location.chapter
                  ? "page"
                  : undefined
              }
              onClick={() =>
                close(() => go({ mode: "bible", book: code, chapter }))
              }
            >
              {ar(chapter)}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
