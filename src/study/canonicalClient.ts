import { dataUrl } from "../lib/dataVersion.ts";
import { createJsonClient } from "../lib/jsonClient.ts";
import { decodeStudyWords } from "./decodeWords.ts";
import type {
  StudyChapterIndex,
  StudyLexicon,
  StudyRange,
  StudyTranslations,
  StudyWords,
  VerseText,
  WordToken,
} from "./types.ts";

const message = () => "تعذر تحميل دراسة الآية. تحقق من الاتصال وحاول مرة أخرى.";
const translationsMessage = () =>
  "تعذر تحميل الترجمات. تحقق من الاتصال وحاول مرة أخرى.";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const bookCode = /^[1-3]?[A-Z]{2,3}$/;

/** IDs are canonical references, never a reading-plan day or passage offset. */
export function studyReference(id: string) {
  const [book, chapter, verse, extra] = id.split(".");
  if (
    !bookCode.test(book) ||
    !/^[1-9]\d*$/.test(chapter ?? "") ||
    !/^[1-9]\d*$/.test(verse ?? "") ||
    extra !== undefined ||
    !positive(Number(chapter)) ||
    !positive(Number(verse))
  )
    throw new Error(message());
  return { book, chapter: Number(chapter), verse: Number(verse) };
}
function chapterParts(key: string) {
  const [book, chapter, extra] = key.split("/");
  if (
    extra !== undefined ||
    !bookCode.test(book) ||
    !/^[1-9]\d*$/.test(chapter ?? "") ||
    !positive(Number(chapter))
  )
    throw new Error(message());
  return { book, chapter: Number(chapter) };
}
function rangeParts(key: string) {
  const [book, chapter, range, extra] = key.split("/");
  const { start, end } = parseRange(range);
  if (extra !== undefined) throw new Error(message());
  return { ...chapterParts(`${book}/${chapter}`), start, end };
}
function parseRange(key: string) {
  const match = /^([1-9]\d*)-([1-9]\d*)$/.exec(key ?? "");
  const start = Number(match?.[1]);
  const end = Number(match?.[2]);
  if (!positive(start) || !positive(end) || start > end)
    throw new Error(message());
  return { start, end };
}
function rangeHeader(
  data: unknown,
  key: string,
): data is { verses: Record<string, unknown> } {
  const { book, chapter, start, end } = rangeParts(key);
  return (
    object(data) &&
    data.v === 2 &&
    data.book === book &&
    data.chapter === chapter &&
    data.start === start &&
    data.end === end &&
    object(data.verses) &&
    Object.keys(data.verses).every(
      (verse) => /^[1-9]\d*$/.test(verse) && +verse >= start && +verse <= end,
    )
  );
}
const verseText = (value: unknown): value is VerseText =>
  typeof value === "string" ||
  (object(value) && typeof value.b === "string" && typeof value.t === "string");
const wordToken = (token: unknown): token is WordToken =>
  Array.isArray(token) &&
  token.length === 8 &&
  token.slice(0, 5).every((value) => typeof value === "string") &&
  ((token[5] === null && token[6] === null) ||
    (Number.isSafeInteger(token[5]) &&
      Number.isSafeInteger(token[6]) &&
      token[5] >= 0 &&
      token[6] >= token[5])) &&
  ["grc", "he", "arc"].includes(token[7]);

export const studyChapter = createJsonClient<StudyChapterIndex>({
  url: (key) => {
    chapterParts(key);
    return dataUrl(`/study/v2/${key}/index.json`);
  },
  validate: (data, key): data is StudyChapterIndex => {
    const { book, chapter } = chapterParts(key);
    if (
      !object(data) ||
      data.v !== 2 ||
      data.book !== book ||
      data.chapter !== chapter ||
      !Array.isArray(data.ranges) ||
      !data.ranges.length
    )
      return false;
    let last = 0;
    return data.ranges.every((range: unknown) => {
      if (
        !object(range) ||
        !positive(range.start) ||
        !positive(range.end) ||
        range.start !== last + 1 ||
        range.end < range.start ||
        range.key !== `${range.start}-${range.end}`
      )
        return false;
      last = range.end;
      return true;
    });
  },
  message,
  maxEntries: 24,
});
export const studyWords = createJsonClient<StudyWords>({
  url: (key) => {
    rangeParts(key);
    return dataUrl(`/study/v2/${key}.words.json.gz`);
  },
  validate: (data, key): data is StudyWords =>
    rangeHeader(data, key) &&
    Object.values(data.verses).every(
      (entry) =>
        object(entry) && Array.isArray(entry.w) && entry.w.every(wordToken),
    ),
  message,
  parse: decodeStudyWords,
  maxEntries: 12,
});
export const studyTranslations = createJsonClient<StudyTranslations>({
  url: (key) => {
    rangeParts(key);
    return dataUrl(`/study/v2/${key}.tr.json`);
  },
  validate: (data, key): data is StudyTranslations =>
    rangeHeader(data, key) &&
    Object.values(data.verses).every(
      (entry) =>
        object(entry) &&
        (entry.n === undefined || verseText(entry.n)) &&
        (entry.e === undefined || verseText(entry.e)),
    ),
  message: translationsMessage,
  maxEntries: 12,
});
export const studyLexicon = createJsonClient<StudyLexicon>({
  url: (shard) => {
    if (!/^[GH]\d{2}$/.test(shard)) throw new Error(message());
    return dataUrl(`/study/v2/lex/${shard}.json`);
  },
  validate: (data, shard): data is StudyLexicon =>
    object(data) &&
    data.v === 2 &&
    data.shard === shard &&
    object(data.lex) &&
    Object.entries(data.lex).every(
      ([strong, entry]) =>
        strong.startsWith(shard) &&
        object(entry) &&
        typeof entry.l === "string" &&
        typeof entry.g === "string" &&
        typeof entry.d === "string",
    ),
  message,
  // A verse needs about 12 shards (up to 30, in Daniel 3:15); all of them
  // together are under 2 MB.
  maxEntries: 64,
});

function rangeFor(index: StudyChapterIndex, verse: number): StudyRange {
  const range = index.ranges.find((r) => verse >= r.start && verse <= r.end);
  if (!range) throw new Error(message());
  return range;
}
/** A view over bounded chapter/range caches; it does not cache a second copy per verse. */
function verseClient<T extends StudyWords | StudyTranslations>(client: {
  load(key: string): Promise<T>;
  peek(key: string): T | undefined;
}) {
  return {
    async load(id: string) {
      const { book, chapter, verse } = studyReference(id);
      const key = `${book}/${chapter}`;
      const index = await studyChapter.load(key);
      try {
        return await client.load(`${key}/${rangeFor(index, verse).key}`);
      } catch (error) {
        // A new publication may split ranges differently. An explicit retry
        // must be able to discover the new index instead of repeating a 404.
        studyChapter.invalidate(key);
        throw error;
      }
    },
    peek(id: string) {
      const { book, chapter, verse } = studyReference(id);
      const key = `${book}/${chapter}`;
      const index = studyChapter.peek(key);
      return index && client.peek(`${key}/${rangeFor(index, verse).key}`);
    },
  };
}
export const verseWords = verseClient(studyWords);
export const verseTranslations = verseClient(studyTranslations);

/** Definitions are optional context; one failed shard does not discard the others. */
export async function wordDefinitions(words: WordToken[]) {
  const shards = [...new Set(words.map((word) => word[2].slice(0, 3)))].filter(
    (shard) => /^[GH]\d{2}$/.test(shard),
  );
  const loaded = await Promise.allSettled(
    shards.map((key) => studyLexicon.load(key)),
  );
  return Object.assign(
    {},
    ...loaded.map((result) =>
      result.status === "fulfilled" ? result.value.lex : {},
    ),
  ) as StudyLexicon["lex"];
}
