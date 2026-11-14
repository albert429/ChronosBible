/** Committed source inputs, canonical coverage audits and reviewed corrections. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catalog as books } from "../../../src/core/scripture/catalog.ts";
import { ROOT } from "../../lib/paths.js";

export const TESTAMENTS = ["OT", "NT"];
export const SOURCE_ID = "chronological-pdf";
/** Reader-facing attribution; the file name and hash stay in source.json. */
export const SOURCE_TITLE = "جدول قراءة زمنية للكتاب المقدس في ٣٦٥ مجموعة";

const bookOf = new Map(books.map((book) => [book.usfm, book]));
export const verseKey = (usfm, chapter, verse) => `${usfm} ${chapter}:${verse}`;

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
