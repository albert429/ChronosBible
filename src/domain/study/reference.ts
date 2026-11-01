/**
 * Canonical study references. Every reading track addresses study by
 * `BOOK.CHAPTER.VERSE`, never by a reading-plan day or passage offset.
 */
export const STUDY_UNAVAILABLE =
  "تعذر تحميل دراسة الآية. تحقق من الاتصال وحاول مرة أخرى.";
const bookCode = /^[1-3]?[A-Z]{2,3}$/;
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export const verseId = (usfm: string, chapter: number, verse: number) =>
  `${usfm}.${chapter}.${verse}`;

/** `BOOK.CHAPTER.VERSE` as its parts; throws on anything else. */
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
    throw new Error(STUDY_UNAVAILABLE);
  return { book, chapter: Number(chapter), verse: Number(verse) };
}
/** A study chapter address, `BOOK/CHAPTER`. */
export function studyChapterParts(key: string) {
  const [book, chapter, extra] = key.split("/");
  if (
    extra !== undefined ||
    !bookCode.test(book) ||
    !/^[1-9]\d*$/.test(chapter ?? "") ||
    !positive(Number(chapter))
  )
    throw new Error(STUDY_UNAVAILABLE);
  return { book, chapter: Number(chapter) };
}
