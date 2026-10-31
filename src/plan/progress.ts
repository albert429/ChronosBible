import { catalog } from "../bible/catalog.ts";
import { findBibleBook } from "../bible/navigation.ts";
import {
  trackOf,
  type AnyReadingLocation,
  type ReadingTrack,
} from "../bible/types.ts";
import {
  MAX_CHRONOLOGY_READINGS,
  isChronologyId,
} from "../chronology/types.ts";
import {
  LOCATION_KEY,
  freshPlaces,
  loadPreferences,
  parseReaderPlaces,
  placesFromPreferences,
  type ReaderPlaces,
} from "../reader/location.ts";
import { today } from "../lib/format.ts";
import { PLAN_DAYS, isPlanDay } from "./schedule.ts";

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
type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Legacy v1 progress; read only to migrate, never written or removed. */
export const PROGRESS_KEY = "nt-reading-progress-v1";
export const STATE_KEY = "bible-reader-state-v2";
export const MAX_READERS = 100;
export const MAX_BACKUP_BYTES = 262144;
const MAX_ID = 100;
const BIBLE_CHAPTERS = catalog.reduce((sum, book) => sum + book.chapters, 0);

const INVALID = "بيانات القراءة غير صالحة. اختر نسخة احتياطية صحيحة.";
const BLOCKED = "لا يسمح المتصفح بحفظ التقدم. اسمح بتخزين بيانات الموقع أولًا.";
const UNREADABLE =
  "تعذر قراءة التقدم المحفوظ. لم نغيّر بياناتك. جرّب استعادة نسخة احتياطية على متصفح آخر.";
const UNSAVED =
  "لم يتم الحفظ. مساحة المتصفح ممتلئة أو التخزين محظور. احتفظ بنسخة احتياطية وحاول مجددًا.";

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
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const validId = (id: unknown): id is string =>
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

function validateReader(value: unknown): Omit<Reader, "id"> {
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
function parseCompletion(value: unknown): TrackCompletion {
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
function parseBackupReader(value: unknown): BackupReader {
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
const freshState = (): ProgressState => ({
  version: 2,
  activeId: null,
  profiles: [],
  guest: { ...freshPlaces(), completion: emptyCompletion() },
  continuous: false,
});

function parseState(raw: string): ProgressState {
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

/** Legacy v1 progress, validated exactly as before. */
function legacyProgress(raw: string) {
  const data = JSON.parse(raw);
  if (
    data.version !== 1 ||
    !Array.isArray(data.profiles) ||
    data.profiles.length > MAX_READERS
  )
    throw Error();
  const profiles: Reader[] = data.profiles.map((p: Reader) => {
    if (!validId(p.id)) throw Error();
    return { id: p.id, ...validateReader(p) };
  });
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length)
    throw Error();
  if (data.activeId !== null && !profiles.some((p) => p.id === data.activeId))
    throw Error();
  return { activeId: data.activeId as string | null, profiles };
}

/**
 * The v2 state built from v1 progress and v1 device places. Readers keep
 * their mode and places; v1 completed days are youth plan days. Without any
 * v1 data this is the fresh state (the Bible at Genesis 1).
 */
export function migrateLegacy(
  progress: string | null,
  location: string | null,
): ProgressState {
  if (!progress && !location) return freshState();
  const preferences = loadPreferences(location);
  const { activeId, profiles } = progress
    ? legacyProgress(progress)
    : { activeId: null, profiles: [] };
  return {
    version: 2,
    activeId,
    profiles: profiles.map((r) => ({
      ...r,
      ...placesFromPreferences(preferences, r.id),
      completion: emptyCompletion(r.completed),
    })),
    guest: {
      ...placesFromPreferences(preferences, ""),
      completion: emptyCompletion(),
    },
    continuous: preferences.continuous,
  };
}

function readItem(storage: StorageLike, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    throw Error(BLOCKED);
  }
}
type Loaded = { state: ProgressState; source: "v2" | "legacy" | "fresh" };
/**
 * The last stored text and its parsed state. Every change builds a new state
 * (nothing here mutates one), so an unchanged text is not parsed and checked
 * again on each navigation and completion.
 */
let parsed: { raw: string; state: ProgressState } | undefined;
function load(storage: StorageLike): Loaded {
  const raw = readItem(storage, STATE_KEY);
  try {
    if (raw) {
      if (parsed?.raw !== raw) parsed = { raw, state: parseState(raw) };
      return { state: parsed.state, source: "v2" };
    }
    const progress = readItem(storage, PROGRESS_KEY);
    let location: string | null = null;
    try {
      location = storage.getItem(LOCATION_KEY);
    } catch {
      /* places are optional */
    }
    return {
      state: migrateLegacy(progress, location),
      source: progress || location ? "legacy" : "fresh",
    };
  } catch (err) {
    if ((err as Error).message === BLOCKED) throw err;
    throw Error(UNREADABLE, { cause: err });
  }
}
/**
 * The device's state. Before the first v2 write this is migrated in memory
 * from the untouched v1 keys, so a failed write is simply retried later.
 */
export const loadProgress = (storage: StorageLike): ProgressState =>
  load(storage).state;

const serialize = (state: ProgressState) =>
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
/** One atomic write of the whole state, confirmed by reading it back. */
function persist(storage: StorageLike, state: ProgressState) {
  const text = serialize(state);
  try {
    // Unchanged (for example, a place saved again): nothing to write.
    if (storage.getItem(STATE_KEY) === text) return;
    storage.setItem(STATE_KEY, text);
    if (storage.getItem(STATE_KEY) !== text) throw Error();
  } catch {
    throw Error(UNSAVED);
  }
}
const update = (
  storage: StorageLike,
  change: (state: ProgressState) => ProgressState,
) => {
  const next = change(loadProgress(storage));
  persist(storage, next);
  return next;
};

/**
 * Commit a pending v1 migration. Safe to repeat: v1 keys are never changed,
 * and until a v2 write succeeds every load migrates again.
 */
export function migrateProgress(storage: StorageLike): {
  state: ProgressState;
  migrated: boolean;
} {
  const { state, source } = load(storage);
  if (source !== "legacy") return { state, migrated: source === "v2" };
  try {
    persist(storage, state);
    return { state, migrated: true };
  } catch {
    return { state, migrated: false };
  }
}

export function currentReader(storage: StorageLike) {
  const s = loadProgress(storage);
  return s.profiles.find((p) => p.id === s.activeId) || null;
}
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
function addProfile(
  storage: StorageLike,
  body: BackupReader | ((state: ProgressState) => BackupReader),
): ReaderProfile {
  let created: ReaderProfile | undefined;
  update(storage, (s) => {
    if (s.profiles.length >= MAX_READERS)
      throw Error("وصلت إلى الحد الأقصى للقراء على هذا الجهاز.");
    created = profile(
      crypto.randomUUID(),
      typeof body === "function" ? body(s) : body,
    );
    return { ...s, activeId: created.id, profiles: [...s.profiles, created] };
  });
  return created!;
}
/**
 * A new active reader. They keep the current reading choice and Bible and
 * chronology places; the youth plan opens on their own scheduled day.
 */
export function createReader(
  storage: StorageLike,
  name: string,
  startDate: string,
  completed: number[] = [],
): ReaderProfile {
  const reader = validateReader({ name, startDate, completed });
  return addProfile(storage, (s) => {
    const { track, places: from } = readerPlaces(s, s.activeId ?? "");
    const kept = { ...from };
    delete kept.plan;
    return {
      name: reader.name,
      startDate: reader.startDate,
      track,
      places: kept,
      completion: emptyCompletion(reader.completed),
    };
  });
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
 * Mark or unmark one reading as completed for a profile, or for the guest
 * when `id` is "". Only that one track's entry changes; completion is only
 * ever explicit, never from opening, reading or listening.
 */
export function setReadingCompletion(
  storage: StorageLike,
  id: string,
  location: AnyReadingLocation,
  completed: boolean,
  date = today(),
): ReaderProfile | GuestState {
  let updated: ReaderProfile | GuestState | undefined;
  update(storage, (s) => {
    if (!id) {
      const guest = stamp(
        {
          ...s.guest,
          completion: toggle(s.guest.completion, location, completed),
        },
        location,
        completed,
        date,
      );
      updated = guest;
      return { ...s, guest };
    }
    const reader = s.profiles.find((p) => p.id === id);
    if (!reader) throw Error("اختر القارئ أولًا.");
    const completion = toggle(reader.completion, location, completed);
    const profile = stamp(
      { ...reader, completion, completed: completion.plan },
      location,
      completed,
      date,
    );
    updated = profile;
    return {
      ...s,
      profiles: s.profiles.map((p) => (p.id === id ? profile : p)),
    };
  });
  return updated!;
}
/** Youth plan days for a profile; kept for existing callers. */
export function setCompletion(
  storage: StorageLike,
  id: string,
  day: number,
  completed: boolean,
): ReaderProfile {
  if (!isPlanDay(day)) throw Error("اليوم غير صالح.");
  if (!id) throw Error("اختر القارئ أولًا.");
  return setReadingCompletion(
    storage,
    id,
    { mode: "plan", day },
    completed,
  ) as ReaderProfile;
}
export function selectReader(storage: StorageLike, id: string | null) {
  let selected: ReaderProfile | null = null;
  update(storage, (s) => {
    if (id !== null && !s.profiles.some((p) => p.id === id))
      throw Error("القارئ غير موجود.");
    selected = s.profiles.find((p) => p.id === id) || null;
    return { ...s, activeId: id };
  });
  return selected;
}
/**
 * Save a reader's places ("" is the guest) and, optionally, continuous play.
 * Completion is untouched.
 */
export function saveReaderPlaces(
  storage: StorageLike,
  id: string,
  places: ReaderPlaces,
  continuous?: boolean,
) {
  const parsed = parseReaderPlaces(places);
  if (!parsed) throw Error(INVALID);
  update(storage, (s) => {
    if (id && !s.profiles.some((p) => p.id === id))
      throw Error("القارئ غير موجود.");
    return {
      ...s,
      guest: id ? s.guest : { ...s.guest, ...parsed },
      profiles: id
        ? s.profiles.map((p) => (p.id === id ? { ...p, ...parsed } : p))
        : s.profiles,
      continuous: continuous ?? s.continuous,
    };
  });
}

/** A version 2 backup: every track's completion and place for one reader. */
export function exportBackup(reader: Reader | ReaderProfile) {
  const completion =
    "completion" in reader
      ? parseCompletion(reader.completion)
      : emptyCompletion(reader.completed);
  const body = parseBackupReader({
    name: reader.name,
    startDate: reader.startDate,
    ...("track" in reader
      ? { track: reader.track, places: reader.places }
      : { track: "plan", places: {} }),
    completion,
    readOn: (reader as ReaderProfile).readOn,
  });
  return JSON.stringify({ version: 2, reader: body }, null, 2);
}
/**
 * Import a v1 (youth plan days only) or v2 backup as a separate new reader,
 * so no existing progress is overwritten.
 */
export function importBackup(storage: StorageLike, text: string) {
  if (text.length > MAX_BACKUP_BYTES)
    throw Error("ملف النسخة الاحتياطية كبير جدًا.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error("اختر ملف نسخة احتياطية بصيغة JSON.");
  }
  if (record(data) && data.version === 1) {
    const r = validateReader(data.reader);
    return addProfile(storage, {
      name: r.name,
      startDate: r.startDate,
      track: "plan",
      places: {},
      completion: emptyCompletion(r.completed),
    });
  }
  if (!record(data) || data.version !== 2)
    throw Error("نسخة احتياطية غير مدعومة.");
  if (
    !onlyKeys(data, ["version", "reader"]) ||
    !record(data.reader) ||
    !onlyKeys(data.reader, [
      "name",
      "startDate",
      "track",
      "places",
      "completion",
      "readOn",
    ])
  )
    throw Error(INVALID);
  return addProfile(storage, parseBackupReader(data.reader));
}
