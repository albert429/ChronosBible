/**
 * The storage adapter for reader profiles: loads, migrates and atomically
 * writes the v2 state, applying the pure transitions in
 * domain/profiles/state.ts. Storage is passed in, so a blocked or full
 * store surfaces as a message and nothing is half-written.
 */
import type { ReadingLocation } from "../../domain/reading/types.ts";
import {
  parseReaderPlaces,
  type ReaderPlaces,
} from "../../domain/reading/places.ts";
import {
  INVALID,
  addReader,
  newReader,
  parseState,
  serializeState,
  validateReader,
  withActiveReader,
  withReaderPlaces,
  withReadingCompletion,
  type BackupReader,
  type GuestState,
  type ProgressState,
  type ReaderProfile,
} from "../../domain/profiles/state.ts";
import { parseBackup } from "../../domain/profiles/backup.ts";
import { migrateLegacy } from "../../domain/profiles/legacy.ts";
import { today } from "../../shared/lib/format.ts";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Legacy v1 progress; read only to migrate, never written or removed. */
export const PROGRESS_KEY = "nt-reading-progress-v1";
export const STATE_KEY = "bible-reader-state-v2";
/** Legacy (v1) device places; read only to migrate into the v2 state. */
export const LOCATION_KEY = "bible-reader-location-v1";

const BLOCKED = "لا يسمح المتصفح بحفظ التقدم. اسمح بتخزين بيانات الموقع أولًا.";
const UNREADABLE =
  "تعذر قراءة التقدم المحفوظ. لم نغيّر بياناتك. جرّب استعادة نسخة احتياطية على متصفح آخر.";
const UNSAVED =
  "لم يتم الحفظ. مساحة المتصفح ممتلئة أو التخزين محظور. احتفظ بنسخة احتياطية وحاول مجددًا.";

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

/** One atomic write of the whole state, confirmed by reading it back. */
function persist(storage: StorageLike, state: ProgressState) {
  const text = serializeState(state);
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
function addProfile(
  storage: StorageLike,
  body: BackupReader | ((state: ProgressState) => BackupReader),
): ReaderProfile {
  let created: ReaderProfile | undefined;
  update(storage, (s) => {
    const added = addReader(
      s,
      crypto.randomUUID(),
      typeof body === "function" ? body(s) : body,
    );
    created = added.reader;
    return added.state;
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
  return addProfile(storage, (s) => newReader(s, reader));
}
/**
 * Mark or unmark one reading as completed for a profile, or for the guest
 * when `id` is "". Only that one track's entry changes; completion is only
 * ever explicit, never from opening, reading or listening.
 */
export function setReadingCompletion(
  storage: StorageLike,
  id: string,
  location: ReadingLocation,
  completed: boolean,
  date = today(),
): ReaderProfile | GuestState {
  let updated: ReaderProfile | GuestState | undefined;
  update(storage, (s) => {
    const result = withReadingCompletion(s, id, location, completed, date);
    updated = result.updated;
    return result.state;
  });
  return updated!;
}
export function selectReader(storage: StorageLike, id: string | null) {
  let selected: ReaderProfile | null = null;
  update(storage, (s) => {
    const result = withActiveReader(s, id);
    selected = result.selected;
    return result.state;
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
  update(storage, (s) => withReaderPlaces(s, id, parsed, continuous));
}
/**
 * Import a v1 (youth plan days only) or v2 backup as a separate new reader,
 * so no existing progress is overwritten.
 */
export const importBackup = (storage: StorageLike, text: string) =>
  addProfile(storage, parseBackup(text));
