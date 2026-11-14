/** Assemble validated reading definitions, titles and catalog summaries. */
import { catalog as books } from "../../../src/core/scripture/catalog.ts";
import {
  chronologyCatalogErrors,
  chronologyDefinitionErrors,
} from "../../../src/features/chronology/data/validate.ts";
import { ar } from "../../../src/shared/lib/format.ts";
import {
  SOURCE_ID,
  SOURCE_TITLE,
  correctedOccurrences,
  sourceOccurrences,
} from "./source.js";
import {
  WORDS_PER_MINUTE,
  groupSegment,
  stageStarts,
  verseSequence,
} from "./grouping.js";

const bookOf = new Map(books.map((book) => [book.usfm, book]));

/**
 * Exact verses read, per book in order of first appearance, as contiguous
 * runs: «التكوين ١١: ٢٧–٣١، ١٢–١٤؛ أخبار الأيام الأول ١: ٥–٧». Gaps are never
 * bridged; a title over 200 characters ends with «…» instead.
 */
export function readingTitle(passages) {
  const byBook = new Map();
  for (const p of passages) {
    if (!byBook.has(p.usfm)) byBook.set(p.usfm, new Set());
    const verses = byBook.get(p.usfm);
    for (let v = p.from; v <= p.to; v++) verses.add(p.chapter * 1000 + v);
  }
  const parts = [...byBook].map(([usfm, set]) => {
    const book = bookOf.get(usfm);
    const last = (chapter) => book.verseCounts[chapter - 1];
    const runs = [];
    for (const key of [...set].sort((a, b) => a - b)) {
      const chapter = Math.floor(key / 1000);
      const verse = key % 1000;
      const run = runs.at(-1);
      const follows =
        run &&
        ((run.c2 === chapter && run.v2 === verse - 1) ||
          (run.c2 === chapter - 1 && run.v2 === last(run.c2) && verse === 1));
      if (follows) Object.assign(run, { c2: chapter, v2: verse });
      else runs.push({ c1: chapter, v1: verse, c2: chapter, v2: verse });
    }
    const chapters = (a, b) => (a === b ? ar(a) : `${ar(a)}–${ar(b)}`);
    const verses = (c, a, b) =>
      `${ar(c)}: ${a === b ? ar(a) : `${ar(a)}–${ar(b)}`}`;
    const text = runs.map(({ c1, v1, c2, v2 }) => {
      const wholeStart = v1 === 1;
      const wholeEnd = v2 === last(c2);
      if (wholeStart && wholeEnd) return chapters(c1, c2);
      if (c1 === c2) return verses(c1, v1, v2);
      // Split at whole-chapter edges: «١١٦–١١٨، ١١٩: ١–٦٤».
      if (wholeStart) return `${chapters(c1, c2 - 1)}، ${verses(c2, 1, v2)}`;
      if (wholeEnd)
        return `${verses(c1, v1, last(c1))}، ${chapters(c1 + 1, c2)}`;
      return `${ar(c1)}: ${ar(v1)}–${ar(c2)}: ${ar(v2)}`;
    });
    return { name: book.name, runs: text };
  });
  const render = (list) =>
    list.map((p) => `${p.name} ${p.runs.join("، ")}`).join("؛ ");
  const full = render(parts);
  if (full.length <= 200) return full;
  // Keep whole runs only, in order, and mark that more follows.
  const kept = [];
  for (const part of parts)
    for (const run of part.runs) {
      const next =
        kept.at(-1)?.name === part.name
          ? [
              ...kept.slice(0, -1),
              { ...kept.at(-1), runs: [...kept.at(-1).runs, run] },
            ]
          : [...kept, { name: part.name, runs: [run] }];
      if (render(next).length + 2 > 200) return `${render(kept)} …`;
      kept.splice(0, kept.length, ...next);
    }
  return full;
}

const groupLabel = (groups) => {
  const first = Math.min(...groups);
  const last = Math.max(...groups);
  return first === last ? String(first) : `${first}-${last}`;
};
const provenanceOf = (occurrences) => {
  const pages = occurrences.map((o) => o.page);
  const page = Math.min(...pages);
  const pageEnd = Math.max(...pages);
  return {
    source: SOURCE_ID,
    page,
    ...(pageEnd > page ? { pageEnd } : {}),
    group: groupLabel(occurrences.map((o) => o.group)),
  };
};

const SUMMARY_KEYS = [
  "id",
  "stageId",
  "substageId",
  "title",
  "estimatedMinutes",
  "verseCount",
  "provenance",
];
const summaryOf = (definition) =>
  Object.fromEntries(
    SUMMARY_KEYS.filter((key) => key in definition).map((key) => [
      key,
      definition[key],
    ]),
  );

/** Builds one testament's catalog and reading definitions from the inputs. */
export function prepareTestament(testament, inputs, chapterOf) {
  const { source, stages, review } = inputs;
  const config = stages.testaments[testament];
  const occurrences = correctedOccurrences(
    sourceOccurrences(source, testament),
    review,
  );
  const items = verseSequence(occurrences, chapterOf);
  const starts = stageStarts(config.stages, items);
  const boundaries = [];
  for (const [i, stage] of starts.entries()) {
    const end = starts[i + 1]?.index ?? items.length;
    const subs = stage.substages.length
      ? stage.substages
      : [{ id: undefined, index: stage.index }];
    for (const [j, sub] of subs.entries())
      boundaries.push({
        stageId: stage.stage,
        substageId: sub.id,
        start: sub.index,
        end: subs[j + 1]?.index ?? end,
      });
  }
  const startsSeen = new Map();
  const definitions = [];
  for (const segment of boundaries) {
    let s = segment.start;
    for (const e of groupSegment(items, segment.start, segment.end)) {
      const slice = items.slice(s, e);
      const passages = [];
      for (const item of slice) {
        const last = passages.at(-1);
        if (last && last.source === item.occurrence) last.to = item.verse;
        else
          passages.push({
            source: item.occurrence,
            from: item.verse,
            to: item.verse,
          });
      }
      const first = slice[0];
      const base = `${first.occurrence.usfm.toLowerCase()}-${first.occurrence.chapter}-${first.verse}`;
      const n = (startsSeen.get(base) ?? 0) + 1;
      startsSeen.set(base, n);
      const words = slice.reduce((sum, item) => sum + item.words, 0);
      const occurrencesOut = passages.map(({ source: o, from, to }) => {
        const whole = from === o.from && to === o.to;
        const exceptions = [...(o.exceptions ?? [])];
        if (!whole)
          exceptions.push({
            kind: "split",
            note: `${o.original} (${o.id}) is divided between readings; this part is ${o.chapter}:${from === to ? from : `${from}-${to}`}.`,
          });
        return {
          id: whole ? o.id : `${o.id}-v${from}`,
          usfm: o.usfm,
          chapter: o.chapter,
          from,
          to,
          provenance: {
            source: SOURCE_ID,
            page: o.page,
            group: String(o.group),
            ...(exceptions.length ? { exceptions } : {}),
          },
        };
      });
      definitions.push({
        id: n === 1 ? base : `${base}-${n}`,
        stageId: segment.stageId,
        ...(segment.substageId ? { substageId: segment.substageId } : {}),
        title: readingTitle(occurrencesOut),
        estimatedMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
        verseCount: slice.length,
        provenance: provenanceOf(passages.map((p) => p.source)),
        testament,
        passages: occurrencesOut,
      });
      s = e;
    }
  }
  const stageOut = config.stages.map((stage) => {
    const of = definitions.filter((d) => d.stageId === stage.id);
    const provenance = (list) =>
      provenanceOf(
        list.flatMap((d) =>
          d.passages.map((p) => ({
            page: p.provenance.page,
            group: Number(p.provenance.group),
          })),
        ),
      );
    return {
      id: stage.id,
      title: stage.title,
      ...(stage.substages
        ? {
            substages: stage.substages.map((sub) => ({
              id: sub.id,
              title: sub.title,
              provenance: provenance(of.filter((d) => d.substageId === sub.id)),
            })),
          }
        : {}),
      provenance: provenance(of),
    };
  });
  const catalog = {
    version: 1,
    testament,
    title: config.title,
    sources: [
      {
        id: SOURCE_ID,
        title: SOURCE_TITLE,
      },
    ],
    stages: stageOut,
    readings: definitions.map(summaryOf),
  };
  const errors = chronologyCatalogErrors(catalog, testament);
  for (const d of definitions)
    errors.push(...chronologyDefinitionErrors(d, testament, d.id, books));
  if (errors.length)
    throw new Error(
      `Invalid ${testament} chronology:\n${errors.slice(0, 20).join("\n")}`,
    );
  return { catalog, definitions, items };
}
