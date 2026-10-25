import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { catalog as books } from "../src/bible/catalog.ts";
import {
  chronologyCatalogErrors,
  chronologyDefinitionErrors,
} from "../src/chronology/validate.ts";
import { ar } from "../src/lib/format.ts";
import { readBibleChapters } from "./build-bible.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const TESTAMENTS = ["OT", "NT"];
export const SOURCE_ID = "chronological-pdf";
/** Reader-facing attribution; the file name and hash stay in source.json. */
export const SOURCE_TITLE = "جدول قراءة زمنية للكتاب المقدس في ٣٦٥ مجموعة";
/**
 * Conservative reading pace. The only measured timing in the repository is
 * the New Testament audio drama (82.3 words/minute over 260 chapters); 80 is
 * used for both testaments so estimates stay consistent and slightly long.
 */
export const WORDS_PER_MINUTE = 80;
export const TARGET_MINUTES = 10;
export const TARGET_WORDS = TARGET_MINUTES * WORDS_PER_MINUTE;
const CATALOG_GZIP_BUDGET = 32 * 1024;

const bookOf = new Map(books.map((book) => [book.usfm, book]));
const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;
const verseKey = (usfm, chapter, verse) => `${usfm} ${chapter}:${verse}`;

/** Committed inputs: normalized source, stage boundaries and reviewed audit. */
export function readChronologyInputs(root = ROOT) {
  const read = (name) =>
    JSON.parse(readFileSync(join(root, "data/chronology", name), "utf8"));
  return {
    source: read("source.json"),
    stages: read("stages.json"),
    review: read("review.json"),
  };
}

/** Source occurrences of one testament in source order, with their group. */
export function sourceOccurrences(source, testament) {
  return source.groups
    .filter((group) => group.testament === testament)
    .flatMap((group) =>
      group.occurrences.map((occurrence) => ({
        ...occurrence,
        group: group.group,
      })),
    );
}

/** Contiguous ranges, in canonical order, as `USFM c:a-b; …`. */
export function rangeLabel(keys) {
  const order = new Map();
  for (const [i, book] of books.entries()) order.set(book.usfm, i);
  const verses = keys
    .map((key) => {
      const [usfm, ref] = key.split(" ");
      const [chapter, verse] = ref.split(":").map(Number);
      return { usfm, chapter, verse };
    })
    .sort(
      (a, b) =>
        order.get(a.usfm) - order.get(b.usfm) ||
        a.chapter - b.chapter ||
        a.verse - b.verse,
    );
  const ranges = [];
  for (const v of verses) {
    const last = ranges.at(-1);
    if (
      last &&
      last.usfm === v.usfm &&
      last.chapter === v.chapter &&
      last.to === v.verse - 1
    )
      last.to = v.verse;
    else
      ranges.push({
        usfm: v.usfm,
        chapter: v.chapter,
        from: v.verse,
        to: v.verse,
      });
  }
  return ranges
    .map(
      (r) =>
        `${r.usfm} ${r.chapter}:${r.from}${r.to === r.from ? "" : `-${r.to}`}`,
    )
    .join("; ");
}

/**
 * Coverage of one testament: canonical verses never read (`omissions`) and
 * verses read more than once, grouped by the occurrences that repeat them.
 */
export function auditOccurrences(occurrences, testament) {
  const seen = new Map();
  let verses = 0;
  for (const occurrence of occurrences)
    for (let verse = occurrence.from; verse <= occurrence.to; verse++) {
      const key = verseKey(occurrence.usfm, occurrence.chapter, verse);
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(occurrence.id);
      verses++;
    }
  const omitted = [];
  let canonical = 0;
  for (const book of books.filter((b) => b.testament === testament))
    book.verseCounts.forEach((count, i) => {
      for (let verse = 1; verse <= count; verse++) {
        canonical++;
        const key = verseKey(book.usfm, i + 1, verse);
        if (!seen.has(key)) omitted.push(key);
      }
    });
  const repeated = new Map();
  for (const [key, ids] of seen)
    if (ids.length > 1) {
      const group = ids.join(",");
      if (!repeated.has(group)) repeated.set(group, []);
      repeated.get(group).push(key);
    }
  const invalid = [...seen.keys()].filter((key) => {
    const [usfm, ref] = key.split(" ");
    const [chapter, verse] = ref.split(":").map(Number);
    const book = bookOf.get(usfm);
    return (
      !book ||
      book.testament !== testament ||
      verse > (book.verseCounts[chapter - 1] ?? 0)
    );
  });
  return {
    occurrences: occurrences.length,
    verses,
    canonical,
    distinct: seen.size,
    invalid: invalid.length ? rangeLabel(invalid) : "",
    omissions: omitted.length ? rangeLabel(omitted).split("; ") : [],
    duplicates: [...repeated].map(([group, keys]) => ({
      occurrences: group.split(","),
      verses: rangeLabel(keys),
    })),
  };
}

/** Applies only reviewed, `applied` corrections, each recorded as an exception. */
export function correctedOccurrences(occurrences, review) {
  const corrections = new Map(
    review.corrections
      .filter((c) => c.status === "applied")
      .map((c) => [c.occurrence, c]),
  );
  return occurrences.map((occurrence) => {
    const correction = corrections.get(occurrence.id);
    if (!correction) return occurrence;
    if (correction.original !== occurrence.original)
      throw new Error(
        `Correction ${occurrence.id} no longer matches the source`,
      );
    return {
      ...occurrence,
      to: correction.to,
      exceptions: [
        {
          kind: "corrected",
          note: `${occurrence.original} → ${occurrence.chapter}:${occurrence.from}-${correction.to}. ${correction.reason}`,
        },
      ],
    };
  });
}

/** Fails unless every omission and repetition in the source has a review entry. */
export function checkReview(source, review) {
  if (review.sourceSha256 !== source.source.sha256)
    throw new Error("Chronology review is for a different source PDF");
  const raw = TESTAMENTS.map((t) =>
    auditOccurrences(sourceOccurrences(source, t), t),
  );
  const problems = [];
  const omissions = raw.flatMap((a) => a.omissions);
  const reviewedOmissions = review.omissions.map((o) => o.verses);
  if (JSON.stringify(omissions) !== JSON.stringify(reviewedOmissions))
    problems.push(
      `omissions ${omissions.join(", ") || "none"} differ from review ${reviewedOmissions.join(", ") || "none"}`,
    );
  const key = (d) => `${d.occurrences.join(",")} ${d.verses}`;
  const found = new Set(raw.flatMap((a) => a.duplicates.map(key)));
  const reviewed = new Set(review.duplicates.map(key));
  for (const d of found)
    if (!reviewed.has(d)) problems.push(`unreviewed repetition ${d}`);
  for (const d of reviewed)
    if (!found.has(d)) problems.push(`reviewed repetition ${d} not in source`);
  for (const a of raw)
    if (a.invalid) problems.push(`invalid references ${a.invalid}`);
  if (problems.length)
    throw new Error(`Chronology audit needs review:\n${problems.join("\n")}`);
  const corrected = TESTAMENTS.map((t) =>
    auditOccurrences(
      correctedOccurrences(sourceOccurrences(source, t), review),
      t,
    ),
  );
  const left = corrected.flatMap((a) => a.omissions);
  const kept = review.omissions
    .filter((o) => o.disposition !== "corrected")
    .map((o) => o.verses);
  if (JSON.stringify(left) !== JSON.stringify(kept))
    throw new Error(`Corrections leave omissions ${left.join(", ")}`);
  return { raw, corrected };
}

/**
 * One item per verse read, in order. `natural` marks a place a reading may
 * begin, from canonical structure only: a chapter start, the verse after a
 * chapter's last verse, or a section heading/acrostic that starts the verse.
 * Source group (daily) boundaries are not breaks on their own.
 */
export function verseSequence(occurrences, chapterOf) {
  const items = [];
  let afterChapterEnd = false;
  for (const occurrence of occurrences) {
    const chapter = chapterOf(occurrence.usfm, occurrence.chapter);
    const count = chapter.passages[0].verses.length;
    const sections = new Set(
      chapter.structure
        .filter(
          (block) =>
            (block.kind === "heading" || block.kind === "acrostic") &&
            block.offset === 0,
        )
        .map((block) => block.verse),
    );
    for (let verse = occurrence.from; verse <= occurrence.to; verse++) {
      items.push({
        occurrence,
        verse,
        words: wordCount(chapter.passages[0].verses[verse - 1].text),
        natural: afterChapterEnd || verse === 1 || sections.has(verse),
      });
      afterChapterEnd = verse === count;
    }
  }
  return items;
}

/** Item index where each stage (and substage) starts. */
export function stageStarts(stages, items) {
  const at = (start, where) => {
    const index = items.findIndex(
      (item) =>
        item.occurrence.id === start.occurrence &&
        item.verse === (start.verse ?? item.occurrence.from),
    );
    const item = items[index];
    if (
      !item ||
      verseKey(item.occurrence.usfm, item.occurrence.chapter, item.verse) !==
        start.first
    )
      throw new Error(`${where} does not start at ${start.first}`);
    return index;
  };
  const starts = stages.map((stage) => ({
    stage: stage.id,
    index: at(stage.start, `Stage ${stage.id}`),
    substages: (stage.substages ?? []).map((sub) => ({
      id: sub.id,
      index: at(sub.start, `Substage ${sub.id}`),
    })),
  }));
  const order = starts.flatMap((s) =>
    s.substages.length ? s.substages.map((sub) => sub.index) : [s.index],
  );
  if (
    starts.some((s) => s.substages.length && s.substages[0].index !== s.index)
  )
    throw new Error("A stage must start with its first substage");
  if (order[0] !== 0 || order.some((n, i) => i && n <= order[i - 1]))
    throw new Error("Stage boundaries must follow the source order");
  return starts;
}

/**
 * Greedy grouping of items [start, end) into readings near `target` words.
 * Each break is the natural boundary whose running total is nearest the
 * target; on a tie the earlier boundary wins. `end` (a stage or substage
 * boundary) is always a break, so a stage may end with a short reading.
 */
export function groupSegment(items, start, end, target = TARGET_WORDS) {
  const total = [0];
  for (let i = start; i < end; i++) total.push(total.at(-1) + items[i].words);
  const words = (from, to) => total[to - start] - total[from - start];
  const breaks = [];
  for (let i = start + 1; i < end; i++) if (items[i].natural) breaks.push(i);
  breaks.push(end);
  const ends = [];
  let s = start;
  while (s < end) {
    const after = breaks.filter((b) => b > s);
    const over = after.findIndex((b) => words(s, b) >= target);
    let choice = end;
    if (over >= 0) {
      const under = over > 0 ? after[over - 1] : undefined;
      choice =
        under !== undefined &&
        target - words(s, under) <= words(s, after[over]) - target
          ? under
          : after[over];
    }
    ends.push(choice);
    s = choice;
  }
  return ends;
}

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

/** Reads all inputs once and prepares both testaments (no file output). */
export function prepareChronology(root = ROOT) {
  const inputs = readChronologyInputs(root);
  const audit = checkReview(inputs.source, inputs.review);
  const chapters = new Map(
    readBibleChapters(root).map((c) => [`${c.usfm}:${c.chapter}`, c]),
  );
  const chapterOf = (usfm, chapter) => chapters.get(`${usfm}:${chapter}`);
  const testaments = Object.fromEntries(
    TESTAMENTS.map((t) => [t, prepareTestament(t, inputs, chapterOf)]),
  );
  return { inputs, audit, testaments };
}

/** Writes `<out>/OT.json`, `<out>/NT.json` and `<out>/<T>/<id>.json`. */
export function buildChronology({ out, root = ROOT }) {
  const { testaments } = prepareChronology(root);
  const summary = [];
  rmSync(out, { recursive: true, force: true });
  for (const testament of TESTAMENTS) {
    const { catalog, definitions } = testaments[testament];
    const json = JSON.stringify(catalog);
    const bytes = gzipSync(json).length;
    if (bytes > CATALOG_GZIP_BUDGET)
      throw new Error(
        `${testament} chronology catalog exceeds ${CATALOG_GZIP_BUDGET} bytes gzip`,
      );
    mkdirSync(join(out, testament), { recursive: true });
    writeFileSync(join(out, `${testament}.json`), json);
    for (const definition of definitions)
      writeFileSync(
        join(out, testament, `${definition.id}.json`),
        JSON.stringify(definition),
      );
    summary.push(
      `${testament} ${definitions.length} readings (${bytes} bytes gzip catalog)`,
    );
  }
  return `Generated chronology: ${summary.join("; ")}.`;
}
