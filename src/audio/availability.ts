import { catalog } from "../bible/catalog.ts";
import {
  readingKey,
  type AnyReadingLocation,
  type AnyScriptureReading,
  type BibleBook,
  type BibleChapter,
  type BibleLocation,
  type PlanLocation,
} from "../bible/types.ts";
import type { Day } from "../plan/readings.ts";

/**
 * Published canonical recordings as one "1"/"0" per chapter in catalog order:
 * a few bytes in the main bundle instead of 1,189 identity strings.
 */
export function chapterAvailability(
  catalog: readonly BibleBook[],
  identities: Iterable<string>,
): string {
  const published = new Set(identities);
  return catalog
    .flatMap((book) =>
      Array.from({ length: book.chapters }, (_, index) =>
        published.has(`bible:${book.usfm}:${index + 1}`) ? "1" : "0",
      ),
    )
    .join("");
}

export function chapterHasAudio(
  catalog: readonly BibleBook[],
  availability: string,
  location: { book: string; chapter: number },
): boolean {
  let index = 0;
  for (const book of catalog) {
    if (book.usfm === location.book)
      return (
        Number.isInteger(location.chapter) &&
        location.chapter >= 1 &&
        location.chapter <= book.chapters &&
        availability[index + location.chapter - 1] === "1"
      );
    index += book.chapters;
  }
  return false;
}

export type AdvertisedAudio = {
  days: { includes(day: number): boolean } | ReadonlySet<number>;
  chapters: string;
  readings: { includes(key: string): boolean } | ReadonlySet<string>;
};
const has = <T>(
  list: { includes(value: T): boolean } | ReadonlySet<T>,
  value: T,
) => ("has" in list ? list.has(value) : list.includes(value));

/**
 * Whether «استمع» may be offered: a prepared day, a published chapter, or a
 * chronological reading whose whole playlist (clips included) was verified
 * on the host. Pure and synchronous; nothing is fetched.
 */
export function audioAvailable(
  target: AnyReadingLocation | AnyScriptureReading,
  advertised: AdvertisedAudio,
  books: readonly BibleBook[] = catalog,
): boolean {
  const mode = "mode" in target ? target.mode : "plan";
  if (mode === "chronological")
    return has(advertised.readings, readingKey(target));
  if (mode === "bible") {
    const chapter = target as BibleLocation | BibleChapter;
    return chapterHasAudio(books, advertised.chapters, {
      book: "usfm" in chapter ? chapter.usfm : chapter.book,
      chapter: chapter.chapter,
    });
  }
  return has(advertised.days, (target as PlanLocation | Day).day);
}

// Inlined by vite.config.ts: verified chronological playlists, as reading
// keys. Declared here, not in the shared src/vite-env.d.ts.
declare const __AUDIO_READINGS__: string[];

let advertised: AdvertisedAudio | undefined;
/**
 * `audioAvailable` for this build's advertised audio (vite.config.ts), built
 * once: the inlined lists become sets instead of new arrays on every call.
 */
export const readingHasAudio = (
  target: AnyReadingLocation | AnyScriptureReading,
) =>
  audioAvailable(
    target,
    (advertised ??= {
      days: new Set(__AUDIO_DAYS__),
      chapters: __AUDIO_CHAPTERS__,
      readings: new Set(__AUDIO_READINGS__),
    }),
  );
