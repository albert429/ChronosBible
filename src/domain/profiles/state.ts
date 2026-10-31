/**
 * The v2 profile state (`bible-reader-state-v2`) as pure data: its schema
 * and validation, per-track completion and dates, and the transitions the
 * storage adapter applies. Nothing here reads or writes storage; every
 * transition returns a new state and never mutates one.
 */
import { catalog, findBibleBook } from "../scripture/catalog.ts";
import { type AnyReadingLocation } from "../reading/types.ts";
import { trackOf, type ReadingTrack } from "../reading/identity.ts";
import {
  MAX_CHRONOLOGY_READINGS,
  isChronologyId,
} from "../reading/chronology.ts";
import {
  freshPlaces,
  parseReaderPlaces,
  type ReaderPlaces,
} from "../reading/places.ts";
import { PLAN_DAYS, isPlanDay } from "../reading/schedule.ts";

/** The youth-plan view of a reader; `completed` lists finished plan days. */
export type Reader = {
  id: string;
  name: string;
  startDate: string;
  completed: number[];
};
/**
 * Explicitly completed readings per track: youth plan days, canonical
 * chapters as `USFM:chapter` (e.g. `GEN:1`) and chronology reading ids.
 */
export type TrackCompletion = {
  bible: string[];
  plan: number[];
  "chrono:OT": string[];
  "chrono:NT": string[];
};
/**
 * The Cairo date each completed reading was marked done, keyed
 * `track|entry` (`plan|12`, `bible|GEN:1`, `chrono:OT|<id>`). Only for
 * readings still completed; absent when empty. Readings completed before
 * dates were kept have no entry. Streaks are derived from it.
 */
export type ReadOn = Record<string, string>;
type Completed = { completion: TrackCompletion; readOn?: ReadOn };
/** A stored reader. `completed` always mirrors `completion.plan`. */
export type ReaderProfile = Reader & ReaderPlaces & Completed;
/**
 * Reading without a profile (id ""): places and explicit completion. Never
 * copied into, or merged with, a profile.
 */
export type GuestState = ReaderPlaces & Completed;
/** Everything on this device. */
export type ProgressState = {
  version: 2;
  activeId: string | null;
  profiles: ReaderProfile[];
  guest: GuestState;
  continuous: boolean;
};
/** The reader portion of a version 2 backup file. */
export type BackupReader = Omit<ReaderProfile, "id" | "completed">;

export const MAX_READERS = 100;
const MAX_ID = 100;
const BIBLE_CHAPTERS = catalog.reduce((sum, book) => sum + book.chapters, 0);

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
/** No saved state at all: the guest at Genesis 1, no readers. */
export const freshState = (): ProgressState => ({
  version: 2,
  activeId: null,
  profiles: [],
  guest: { ...freshPlaces(), completion: emptyCompletion() },
  continuous: false,
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

/** A reader's places; "" (or an unknown id) is the guest. */
export function readerPlaces(state: ProgressState, id: string): ReaderPlaces {
  const reader =
    (id ? state.profiles.find((p) => p.id === id) : undefined) ?? state.guest;
  return { track: reader.track, places: reader.places };
}
/** A reader's completion; "" is the guest. Undefined for an unknown id. */
export function readerCompletion(
  state: ProgressState,
  id: string,
): TrackCompletion | undefined {
  return id
    ? state.profiles.find((p) => p.id === id)?.completion
    : state.guest.completion;
}

/** Adds a reader with this id and makes them active. */
export function addReader(
  state: ProgressState,
  id: string,
  body: BackupReader,
): { state: ProgressState; reader: ReaderProfile } {
  if (state.profiles.length >= MAX_READERS)
    throw Error("وصلت إلى الحد الأقصى للقراء على هذا الجهاز.");
  const reader = profile(id, body);
  return {
    state: {
      ...state,
      activeId: reader.id,
      profiles: [...state.profiles, reader],
    },
    reader,
  };
}
/**
 * A new reader's body, from a reader checked with `validateReader`. They
 * keep the current reading choice and Bible and chronology places; the
 * youth plan opens on their own scheduled day.
 */
export function newReader(
  state: ProgressState,
  reader: Omit<Reader, "id">,
): BackupReader {
  const { track, places: from } = readerPlaces(state, state.activeId ?? "");
  const kept = { ...from };
  delete kept.plan;
  return {
    name: reader.name,
    startDate: reader.startDate,
    track,
    places: kept,
    completion: emptyCompletion(reader.completed),
  };
}

/** The completion entry for a place: plan day, `USFM:chapter` or reading id. */
export function completionEntry(location: AnyReadingLocation) {
  if (location.mode === "plan") return location.day;
  if (location.mode === "bible") return `${location.book}:${location.chapter}`;
  return location.readingId;
}
export function isReadingComplete(
  reader: Pick<ReaderProfile, "completion">,
  location: AnyReadingLocation,
): boolean {
  const done: (string | number)[] = reader.completion[trackOf(location)];
  return done.includes(completionEntry(location));
}
function toggle(
  completion: TrackCompletion,
  location: AnyReadingLocation,
  completed: boolean,
): TrackCompletion {
  const track: ReadingTrack = trackOf(location);
  const entry = completionEntry(location);
  const valid =
    track === "plan"
      ? isPlanDay(entry as number)
      : track === "bible"
        ? validChapterId(entry)
        : isChronologyId(entry);
  if (!valid) throw Error("القراءة غير صالحة.");
  const done = new Set<string | number>(completion[track]);
  if (completed) done.add(entry);
  else done.delete(entry);
  const list = [...done];
  if (
    list.length > (track === "bible" ? BIBLE_CHAPTERS : MAX_CHRONOLOGY_READINGS)
  )
    throw Error("القراءة غير صالحة.");
  return {
    ...completion,
    [track]: track === "plan" ? days(list as number[]) : list,
  };
}
/**
 * Record when a reading was marked done (keeping an earlier date), or forget
 * it when unmarked. An empty record is removed.
 */
function stamp<T extends Completed>(
  reader: T,
  location: AnyReadingLocation,
  completed: boolean,
  date: string,
): T {
  const key = `${trackOf(location)}|${completionEntry(location)}`;
  const { readOn = {}, ...rest } = reader;
  const next = { ...readOn };
  if (completed) next[key] ??= date;
  else delete next[key];
  return withReadOn(rest, Object.keys(next).length ? next : undefined) as T;
}
/**
 * Mark or unmark one reading as completed on `date` for a profile, or for
 * the guest when `id` is "". Only that one track's entry changes;
 * completion is only ever explicit, never from opening, reading or
 * listening.
 */
export function withReadingCompletion(
  state: ProgressState,
  id: string,
  location: AnyReadingLocation,
  completed: boolean,
  date: string,
): { state: ProgressState; updated: ReaderProfile | GuestState } {
  if (!id) {
    const guest = stamp(
      {
        ...state.guest,
        completion: toggle(state.guest.completion, location, completed),
      },
      location,
      completed,
      date,
    );
    return { state: { ...state, guest }, updated: guest };
  }
  const reader = state.profiles.find((p) => p.id === id);
  if (!reader) throw Error("اختر القارئ أولًا.");
  const completion = toggle(reader.completion, location, completed);
  const profile = stamp(
    { ...reader, completion, completed: completion.plan },
    location,
    completed,
    date,
  );
  return {
    state: {
      ...state,
      profiles: state.profiles.map((p) => (p.id === id ? profile : p)),
    },
    updated: profile,
  };
}
/** Make a reader active, or nobody (the guest) with null. */
export function withActiveReader(
  state: ProgressState,
  id: string | null,
): { state: ProgressState; selected: ReaderProfile | null } {
  if (id !== null && !state.profiles.some((p) => p.id === id))
    throw Error("القارئ غير موجود.");
  return {
    state: { ...state, activeId: id },
    selected: state.profiles.find((p) => p.id === id) || null,
  };
}
/**
 * A reader's places ("" is the guest) and, optionally, continuous play.
 * `parsed` comes from `parseReaderPlaces`. Completion is untouched.
 */
export function withReaderPlaces(
  state: ProgressState,
  id: string,
  parsed: ReaderPlaces,
  continuous?: boolean,
): ProgressState {
  if (id && !state.profiles.some((p) => p.id === id))
    throw Error("القارئ غير موجود.");
  return {
    ...state,
    guest: id ? state.guest : { ...state.guest, ...parsed },
    profiles: id
      ? state.profiles.map((p) => (p.id === id ? { ...p, ...parsed } : p))
      : state.profiles,
    continuous: continuous ?? state.continuous,
  };
}
