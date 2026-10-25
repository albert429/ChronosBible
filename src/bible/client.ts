import { createJsonClient } from "../lib/jsonClient.ts";
import { dataUrl } from "../lib/dataVersion.ts";
import { catalog } from "./catalog.ts";
import { findBibleBook, validBibleLocation } from "./navigation.ts";
import { readingKey, type BibleChapter, type BibleLocation } from "./types.ts";

export function chapterLocation(key: string): BibleLocation | undefined {
  const match = /^bible:([A-Z0-9]{3}):([1-9]\d*)$/.exec(key);
  if (!match) return;
  const location: BibleLocation = {
    mode: "bible",
    book: match[1],
    chapter: Number(match[2]),
  };
  return validBibleLocation(catalog, location) ? location : undefined;
}

export function validBibleChapter(
  data: unknown,
  key: string,
): data is BibleChapter {
  const location = chapterLocation(key);
  if (!location || !data || typeof data !== "object") return false;
  const chapter = data as BibleChapter;
  const book = findBibleBook(catalog, location.book)!;
  const count = book.verseCounts[location.chapter - 1];
  if (
    "day" in chapter ||
    chapter.mode !== "bible" ||
    chapter.usfm !== book.usfm ||
    chapter.book !== book.name ||
    chapter.chapter !== location.chapter ||
    chapter.verseCount !== count ||
    !Array.isArray(chapter.passages) ||
    chapter.passages.length !== 1 ||
    !Array.isArray(chapter.structure)
  )
    return false;
  const passage = chapter.passages[0];
  if (
    !passage ||
    passage.book !== book.name ||
    passage.chapter !== location.chapter ||
    passage.start !== 1 ||
    passage.end !== count ||
    !Array.isArray(passage.verses) ||
    passage.verses.length !== count ||
    !passage.verses.every(
      (verse, i) =>
        !!verse &&
        verse.number === i + 1 &&
        typeof verse.text === "string" &&
        verse.text.trim().length > 0,
    )
  )
    return false;
  return chapter.structure.every((block, i) => {
    if (
      !block ||
      ![
        "heading",
        "superscription",
        "acrostic",
        "paragraph",
        "poetry",
      ].includes(block.kind) ||
      typeof block.marker !== "string" ||
      !/^[a-z][a-z0-9]*$/.test(block.marker) ||
      !Number.isInteger(block.verse) ||
      block.verse < 1 ||
      block.verse > count ||
      !Number.isInteger(block.offset) ||
      block.offset < 0 ||
      block.offset > Array.from(passage.verses[block.verse - 1].text).length ||
      (block.text !== undefined &&
        (typeof block.text !== "string" || !block.text.trim())) ||
      (["heading", "superscription", "acrostic"].includes(block.kind) &&
        !block.text)
    )
      return false;
    const previous = chapter.structure[i - 1];
    return (
      !previous ||
      previous.verse < block.verse ||
      (previous.verse === block.verse && previous.offset <= block.offset)
    );
  });
}

export function createBibleClient(
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
) {
  const client = createJsonClient<BibleChapter>(
    {
      url: (key) => {
        const location = chapterLocation(key);
        if (!location) throw new Error("Invalid canonical chapter key");
        return dataUrl(`/bible/${location.book}/${location.chapter}.json`);
      },
      validate: validBibleChapter,
      message: () => "تعذر تحميل الإصحاح. تحقق من الاتصال وحاول مرة أخرى.",
    },
    fetcher,
    timeoutMs,
  );
  return {
    ...client,
    prefetchChapter: (location: BibleLocation): Promise<void> => {
      if (!validBibleLocation(catalog, location)) return Promise.resolve();
      return client.load(readingKey(location)).then(
        () => {},
        () => {},
      );
    },
  };
}

export const chapters = createBibleClient();
