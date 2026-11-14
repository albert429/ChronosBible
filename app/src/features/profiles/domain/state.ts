/** Pure profile transitions and selectors; nothing reads or writes storage. */
import type { ReadingLocation } from "../../../core/reading/types.ts";
import { trackOf, type ReadingTrack } from "../../../core/reading/identity.ts";
import {
  MAX_CHRONOLOGY_READINGS,
  isChronologyId,
} from "../../../core/reading/chronology.ts";
import {
  freshPlaces,
  type ReaderPlaces,
} from "../../../core/reading/places.ts";
import { isPlanDay } from "../../../core/reading/schedule.ts";
import {
  BIBLE_CHAPTERS,
  MAX_READERS,
  emptyCompletion,
  validChapterId,
} from "./serialization.ts";
import type {
  BackupReader,
  Completed,
  GuestState,
  ProgressState,
  Reader,
  ReaderProfile,
  TrackCompletion,
} from "./types.ts";

/** No saved state at all: the guest at Genesis 1, no readers. */
export const freshState = (): ProgressState => ({
  version: 2,
  activeId: null,
  profiles: [],
  guest: { ...freshPlaces(), completion: emptyCompletion() },
  continuous: false,
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
  const reader: ReaderProfile = {
    id,
    ...body,
    completed: body.completion.plan,
  };
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
export function completionEntry(location: ReadingLocation) {
  if (location.mode === "plan") return location.day;
  if (location.mode === "bible") return `${location.book}:${location.chapter}`;
  return location.readingId;
}
export function isReadingComplete(
  reader: Pick<ReaderProfile, "completion">,
  location: ReadingLocation,
): boolean {
  const done: (string | number)[] = reader.completion[trackOf(location)];
  return done.includes(completionEntry(location));
}
function toggle(
  completion: TrackCompletion,
  location: ReadingLocation,
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
    [track]: track === "plan" ? (list as number[]).sort((a, b) => a - b) : list,
  };
}
/**
 * Record when a reading was marked done (keeping an earlier date), or forget
 * it when unmarked. An empty record is removed.
 */
function stamp<T extends Completed>(
  reader: T,
  location: ReadingLocation,
  completed: boolean,
  date: string,
): T {
  const key = `${trackOf(location)}|${completionEntry(location)}`;
  const { readOn = {}, ...rest } = reader;
  const next = { ...readOn };
  if (completed) next[key] ??= date;
  else delete next[key];
  return (Object.keys(next).length ? { ...rest, readOn: next } : rest) as T;
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
  location: ReadingLocation,
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
