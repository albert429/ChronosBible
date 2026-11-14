import { ar } from "../../shared/lib/format.ts";

type Range = { start: number; end: number };

export const rangeText = ({ start, end }: Range) =>
  start === end ? ar(start) : `${ar(start)}–${ar(end)}`;

/** «٣: ١٦–١٨» for a passage, «٣: ١٦» for a single verse. */
export const chapterRange = (chapter: number, range: Range) =>
  `${ar(chapter)}: ${rangeText(range)}`;
export const chapterVerse = (chapter: number, verse: number) =>
  chapterRange(chapter, { start: verse, end: verse });

/** Spoken form for assistive technology. */
export const rangeAriaLabel = (chapter: number, range: Range) =>
  `الإصحاح ${ar(chapter)}، ${range.start === range.end ? "الآية" : "الآيات"} ${rangeText(range)}`;

/** Isolates text so its parts keep their order inside an Arabic sentence. */
export const isolate = (text: string) => `⁦${text}⁩`;
