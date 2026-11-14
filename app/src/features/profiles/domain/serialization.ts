/** Validate stored profiles and backup bodies; serialize only known fields. */
import { catalog, findBibleBook } from "../../../core/scripture/catalog.ts";
import {
  MAX_CHRONOLOGY_READINGS,
  isChronologyId,
} from "../../../core/reading/chronology.ts";
import { parseReaderPlaces } from "../../../core/reading/places.ts";
import { PLAN_DAYS, isPlanDay } from "../../../core/reading/schedule.ts";
import type {
  BackupReader,
  GuestState,
  ProgressState,
  ReadOn,
  Reader,
  ReaderProfile,
  TrackCompletion,
} from "./types.ts";

export const MAX_READERS = 100;
const MAX_ID = 100;
export const BIBLE_CHAPTERS = catalog.reduce(
  (sum, book) => sum + book.chapters,
  0,
);

export const INVALID = "بيانات القراءة غير صالحة. اختر نسخة احتياطية صحيحة.";

export function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= "2000-01-01" &&
    value <= "2100-12-31" &&
    !isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const onlyKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
export const validId = (id: unknown): id is string =>
  typeof id === "string" && !!id && id.length <= MAX_ID;
export const validChapterId = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  // No leading zeros: one chapter has exactly one identifier.
  const match = /^([A-Z0-9]{3}):([1-9]\d{0,2})$/.exec(value);
  const book = match && findBibleBook(catalog, match[1]);
  return !!book && Number(match[2]) >= 1 && Number(match[2]) <= book.chapters;
};
const unique = <T>(items: T[]) => [...new Set(items)];
const days = (items: number[]) => unique(items).sort((a, b) => a - b);

export function validateReader(value: unknown): Omit<Reader, "id"> {
  const r = value as Partial<Reader> | null;
  if (
    !r ||
    typeof r.name !== "string" ||
    !r.name.trim() ||
    r.name.trim().length > 60 ||
    !validDate(r.startDate) ||
    !Array.isArray(r.completed) ||
    r.completed.length > PLAN_DAYS ||
    r.completed.some((n) => !isPlanDay(n))
  )
    throw Error(INVALID);
  return {
    name: r.name.trim(),
    startDate: r.startDate,
    completed: days(r.completed),
  };
}
export const emptyCompletion = (plan: number[] = []): TrackCompletion => ({
  bible: [],
  plan: days(plan),
  "chrono:OT": [],
  "chrono:NT": [],
});
export function parseCompletion(value: unknown): TrackCompletion {
  if (
    !record(value) ||
    !onlyKeys(value, ["bible", "plan", "chrono:OT", "chrono:NT"])
  )
    throw Error(INVALID);
  const list = <T>(
    items: unknown,
    max: number,
    valid: (item: unknown) => item is T,
  ): T[] => {
    if (!Array.isArray(items) || items.length > max || !items.every(valid))
      throw Error(INVALID);
    return unique(items);
  };
  return {
    bible: list(value.bible, BIBLE_CHAPTERS, validChapterId),
    plan: days(
      list(value.plan, PLAN_DAYS, (n): n is number => isPlanDay(n as number)),
    ),
    "chrono:OT": list(
      value["chrono:OT"],
      MAX_CHRONOLOGY_READINGS,
      isChronologyId,
    ),
    "chrono:NT": list(
      value["chrono:NT"],
      MAX_CHRONOLOGY_READINGS,
      isChronologyId,
    ),
  };
}
/**
 * Dates for completed readings only. Anything else (a reading no longer
 * completed, a bad key or date) is dropped rather than rejected: dates are a
 * convenience and must never make progress unreadable.
 */
function parseReadOn(
  value: unknown,
  completion: TrackCompletion,
): ReadOn | undefined {
  if (!record(value)) return undefined;
  const completed = new Set(
    Object.entries(completion).flatMap(([track, done]) =>
      done.map((entry) => `${track}|${entry}`),
    ),
  );
  const kept = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      completed.has(entry[0]) && validDate(entry[1]),
  );
  return kept.length ? Object.fromEntries(kept) : undefined;
}
const withReadOn = <T extends object>(body: T, readOn?: ReadOn) =>
  readOn ? { ...body, readOn } : body;

const places = (value: unknown) => {
  const parsed = parseReaderPlaces(value);
  if (!parsed) throw Error(INVALID);
  return parsed;
};
/** A v2 backup reader or stored profile body, rebuilt from known fields. */
export function parseBackupReader(value: unknown): BackupReader {
  if (!record(value)) throw Error(INVALID);
  const completion = parseCompletion(value.completion);
  const { name, startDate } = validateReader({
    name: value.name,
    startDate: value.startDate,
    completed: completion.plan,
  });
  return withReadOn(
    { name, startDate, ...places(value), completion },
    parseReadOn(value.readOn, completion),
  );
}
const profile = (id: string, body: BackupReader): ReaderProfile => ({
  id,
  ...body,
  completed: body.completion.plan,
});
/** A stored v2 state, strictly validated; throws on anything unexpected. */
export function parseState(raw: string): ProgressState {
  const data: unknown = JSON.parse(raw);
  if (
    !record(data) ||
    data.version !== 2 ||
    !Array.isArray(data.profiles) ||
    data.profiles.length > MAX_READERS ||
    typeof data.continuous !== "boolean"
  )
    throw Error();
  const profiles = data.profiles.map((p: unknown) => {
    if (!record(p) || !validId(p.id)) throw Error();
    return profile(p.id, parseBackupReader(p));
  });
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length)
    throw Error();
  if (data.activeId !== null && !profiles.some((p) => p.id === data.activeId))
    throw Error();
  return {
    version: 2,
    activeId: data.activeId as string | null,
    profiles,
    guest: parseGuest(data.guest),
    continuous: data.continuous,
  };
}

/** Early v2 states stored the guest without completion: read it as empty. */
function parseGuest(value: unknown): GuestState {
  const completion =
    record(value) && value.completion !== undefined
      ? parseCompletion(value.completion)
      : emptyCompletion();
  return withReadOn(
    { ...places(value), completion },
    parseReadOn((value as { readOn?: unknown }).readOn, completion),
  );
}

/** The stored text for a state; known fields only, in a fixed order. */
export const serializeState = (state: ProgressState) =>
  JSON.stringify({
    version: 2,
    activeId: state.activeId,
    // `readOn` is left out when undefined.
    profiles: state.profiles.map((p) => ({
      id: p.id,
      name: p.name,
      startDate: p.startDate,
      track: p.track,
      places: p.places,
      completion: p.completion,
      readOn: p.readOn,
    })),
    guest: state.guest,
    continuous: state.continuous,
  });
