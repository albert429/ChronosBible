import { useEffect, useState } from "react";
import { Copy, Share2 } from "lucide-react";
import { catalog } from "../bible/catalog";
import { readingSearch } from "../bible/navigation";

export type VerseActionsProps = {
  /** The book's Arabic name, as passages carry it. */
  book: string;
  chapter: number;
  verse: number;
  text: string;
  reference: string;
};

/** Copy a verse with its reference, or share it as a link to that verse. */
export default function VerseActions({
  book,
  chapter,
  verse,
  text,
  reference,
}: VerseActionsProps) {
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), 4000);
    return () => clearTimeout(timer);
  }, [status]);
  const usfm = catalog.find((item) => item.name === book)?.usfm;
  const url =
    usfm &&
    `${location.origin}${location.pathname}${readingSearch({ mode: "bible", book: usfm, chapter, verse })}`;
  const quote = `«${text}» (${reference})`;
  async function copy(value: string, done: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(done);
    } catch {
      setStatus("تعذر النسخ. حدّد نص الآية وانسخه.");
    }
  }
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: reference, text: quote, url });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    await copy(url ? `${quote}\n${url}` : quote, "تم نسخ الآية ورابطها");
  }
  return (
    <div className="verse-actions">
      <button
        type="button"
        className="quiet-button"
        onClick={() => copy(quote, "تم نسخ الآية")}
      >
        <Copy size={17} aria-hidden="true" />
        نسخ الآية
      </button>
      <button type="button" className="quiet-button" onClick={share}>
        <Share2 size={17} aria-hidden="true" />
        مشاركة
      </button>
      <p className="verse-actions-status" role="status">
        {status}
      </p>
    </div>
  );
}
