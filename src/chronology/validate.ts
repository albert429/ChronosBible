/** Pure structural checks for chronology data; no catalog is imported. */
import type { BibleBook, Testament } from "../bible/types.ts";
import {
  MAX_CHRONOLOGY_READINGS,
  PROVENANCE_EXCEPTION_KINDS,
  isChronologyId,
  type ChronologicalReading,
  type ChronologicalReadingDefinition,
  type ChronologyCatalog,
  type PassageOccurrence,
  type SourceProvenance,
} from "./types.ts";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const page = (value: unknown) =>
  value === undefined ||
  (Number.isInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= 9999);

export function validProvenance(value: unknown): value is SourceProvenance {
  if (!record(value) || !text(value.source, 80)) return false;
  if (!page(value.page) || !page(value.pageEnd)) return false;
  if (
    value.pageEnd !== undefined &&
    (value.page === undefined ||
      (value.pageEnd as number) < (value.page as number))
  )
    return false;
  if (value.group !== undefined && !text(value.group, 80)) return false;
  return (
    value.exceptions === undefined ||
    (Array.isArray(value.exceptions) &&
      value.exceptions.length <= 20 &&
      value.exceptions.every(
        (exception) =>
          record(exception) &&
          PROVENANCE_EXCEPTION_KINDS.includes(exception.kind as never) &&
          text(exception.note, 500),
      ))
  );
}

/** A verse range inside one chapter of the given testament's books. */
export function validOccurrence(
  value: unknown,
  books: readonly BibleBook[],
  testament?: Testament,
): value is PassageOccurrence {
  if (!record(value) || !isChronologyId(value.id)) return false;
  const book = books.find((candidate) => candidate.usfm === value.usfm);
  if (!book || (testament && book.testament !== testament)) return false;
  const { chapter, from, to } = value;
  if (
    !Number.isInteger(chapter) ||
    (chapter as number) < 1 ||
    (chapter as number) > book.chapters
  )
    return false;
  const verses = book.verseCounts[(chapter as number) - 1];
  return (
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    (from as number) >= 1 &&
    (from as number) <= (to as number) &&
    (to as number) <= verses &&
    (value.provenance === undefined || validProvenance(value.provenance))
  );
}

/** Problems with a summary's own fields (not its stage references). */
function summaryErrors(
  reading: Record<string, unknown>,
  where: string,
  provenance: (where: string, value: unknown) => void,
): string[] {
  const errors: string[] = [];
  if (!isChronologyId(reading.stageId)) errors.push(`${where}: bad stageId`);
  if (reading.substageId !== undefined && !isChronologyId(reading.substageId))
    errors.push(`${where}: bad substageId`);
  if (!text(reading.title)) errors.push(`${where}: missing title`);
  const minutes = reading.estimatedMinutes;
  if (
    !Number.isInteger(minutes) ||
    (minutes as number) < 1 ||
    (minutes as number) > 600
  )
    errors.push(`${where}: bad estimatedMinutes`);
  const verses = reading.verseCount;
  if (
    verses !== undefined &&
    (!Number.isInteger(verses) || (verses as number) < 1)
  )
    errors.push(`${where}: bad verseCount`);
  provenance(where, reading.provenance);
  return errors;
}

/**
 * Every problem with a catalog of reading summaries, or [] when usable.
 * Summaries must not carry passages; those belong to definitions.
 */
export function chronologyCatalogErrors(
  value: unknown,
  testament: Testament,
): string[] {
  if (!record(value)) return ["catalog is not an object"];
  const errors: string[] = [];
  if (value.version !== 1) errors.push("unsupported version");
  if (value.testament !== testament) errors.push("wrong testament");
  if (!text(value.title)) errors.push("missing title");
  const sources = new Set<string>();
  if (!Array.isArray(value.sources)) errors.push("sources must be a list");
  else
    for (const source of value.sources)
      if (record(source) && text(source.id, 80) && text(source.title))
        sources.add(source.id as string);
      else errors.push("invalid source");
  const checkProvenance = (where: string, provenance: unknown) => {
    if (provenance === undefined) return;
    if (!validProvenance(provenance)) errors.push(`${where}: bad provenance`);
    else if (!sources.has(provenance.source))
      errors.push(`${where}: unknown source ${provenance.source}`);
  };
  const stages = new Map<string, Set<string>>();
  if (!Array.isArray(value.stages)) errors.push("stages must be a list");
  else
    for (const stage of value.stages) {
      if (!record(stage) || !isChronologyId(stage.id) || !text(stage.title)) {
        errors.push("invalid stage");
        continue;
      }
      if (stages.has(stage.id)) errors.push(`duplicate stage ${stage.id}`);
      const substages = new Set<string>();
      stages.set(stage.id, substages);
      checkProvenance(`stage ${stage.id}`, stage.provenance);
      if (stage.substages === undefined) continue;
      if (!Array.isArray(stage.substages)) {
        errors.push(`stage ${stage.id}: substages must be a list`);
        continue;
      }
      for (const sub of stage.substages)
        if (!record(sub) || !isChronologyId(sub.id) || !text(sub.title))
          errors.push(`stage ${stage.id}: invalid substage`);
        else if (substages.has(sub.id))
          errors.push(`stage ${stage.id}: duplicate substage ${sub.id}`);
        else {
          substages.add(sub.id);
          checkProvenance(`substage ${sub.id}`, sub.provenance);
        }
    }
  if (!Array.isArray(value.readings) || !value.readings.length)
    return [...errors, "readings must be a non-empty list"];
  if (value.readings.length > MAX_CHRONOLOGY_READINGS)
    errors.push("too many readings");
  const ids = new Set<string>();
  for (const reading of value.readings) {
    if (!record(reading) || !isChronologyId(reading.id)) {
      errors.push("invalid reading id");
      continue;
    }
    const where = `reading ${reading.id}`;
    if (ids.has(reading.id)) errors.push(`duplicate ${where}`);
    ids.add(reading.id);
    const substages = stages.get(reading.stageId as string);
    if (!substages) errors.push(`${where}: unknown stage`);
    else if (
      reading.substageId !== undefined &&
      !substages.has(reading.substageId as string)
    )
      errors.push(`${where}: unknown substage`);
    if ("passages" in reading)
      errors.push(`${where}: summaries carry no passages`);
    errors.push(...summaryErrors(reading, where, checkProvenance));
  }
  return errors;
}

export const isChronologyCatalog = (
  value: unknown,
  testament: Testament,
): value is ChronologyCatalog =>
  chronologyCatalogErrors(value, testament).length === 0;

/**
 * Every problem with one reading's definition, or [] when usable. Each
 * passage reference is checked strictly against the canonical `books` of
 * that testament; `verseCount`, when given, must equal the ranges' total.
 */
export function chronologyDefinitionErrors(
  value: unknown,
  testament: Testament,
  id: string,
  books: readonly BibleBook[],
): string[] {
  if (!record(value)) return ["definition is not an object"];
  const errors: string[] = [];
  if (value.id !== id || !isChronologyId(value.id)) errors.push("wrong id");
  if (value.testament !== testament) errors.push("wrong testament");
  const where = `reading ${id}`;
  errors.push(
    ...summaryErrors(value, where, (at, provenance) => {
      if (provenance !== undefined && !validProvenance(provenance))
        errors.push(`${at}: bad provenance`);
    }),
  );
  if (!Array.isArray(value.passages) || !value.passages.length)
    return [...errors, `${where}: no passages`];
  if (value.passages.length > 200) errors.push(`${where}: too many passages`);
  const occurrences = new Set<string>();
  let verses = 0;
  for (const occurrence of value.passages) {
    if (!validOccurrence(occurrence, books, testament)) {
      errors.push(`${where}: invalid passage`);
      continue;
    }
    if (occurrences.has(occurrence.id))
      errors.push(`${where}: duplicate occurrence ${occurrence.id}`);
    occurrences.add(occurrence.id);
    verses += occurrence.to - occurrence.from + 1;
  }
  if (
    value.verseCount !== undefined &&
    !errors.length &&
    value.verseCount !== verses
  )
    errors.push(`${where}: verseCount ${value.verseCount} is not ${verses}`);
  return errors;
}
export const isChronologyDefinition = (
  value: unknown,
  testament: Testament,
  id: string,
  books: readonly BibleBook[],
): value is ChronologicalReadingDefinition =>
  chronologyDefinitionErrors(value, testament, id, books).length === 0;

/** A fetched reading that is the requested one, with consistent verses. */
export function isChronologicalReadingData(
  value: unknown,
  testament: Testament,
  id: string,
): value is ChronologicalReading {
  if (
    !record(value) ||
    value.mode !== "chronological" ||
    value.testament !== testament ||
    value.id !== id ||
    !isChronologyId(value.stageId) ||
    !text(value.title) ||
    !Number.isInteger(value.verseCount) ||
    !Array.isArray(value.passages) ||
    !value.passages.length
  )
    return false;
  let verses = 0;
  for (const passage of value.passages) {
    if (
      !record(passage) ||
      !isChronologyId(passage.occurrenceId) ||
      typeof passage.book !== "string" ||
      !Number.isInteger(passage.chapter) ||
      !Number.isInteger(passage.start) ||
      !Number.isInteger(passage.end) ||
      (passage.start as number) > (passage.end as number) ||
      !Array.isArray(passage.verses) ||
      !passage.verses.length
    )
      return false;
    verses += passage.verses.length;
  }
  return verses === value.verseCount;
}
