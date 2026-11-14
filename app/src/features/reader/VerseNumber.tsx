import { ar } from "../../shared/lib/format";

/**
 * A verse's number: the button that opens its study sheet from the keyboard
 * (see `verseNumberButton` in shared/browser/scriptureDom.ts).
 */
export default function VerseNumber({ number }: { number: number }) {
  return (
    <sup>
      <button
        type="button"
        className="verse-number"
        aria-haspopup="dialog"
        aria-label={`تفاصيل الآية ${ar(number)}`}
      >
        {ar(number)}
      </button>
    </sup>
  );
}
