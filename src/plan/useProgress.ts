import { useSyncExternalStore } from "react";
import type { AnyReadingLocation } from "../bible/types";
import {
  PROGRESS_KEY,
  STATE_KEY,
  createReader,
  importBackup,
  loadProgress,
  migrateProgress,
  selectReader,
  setCompletion,
  emptyCompletion,
  setReadingCompletion,
  type GuestState,
  type ReadOn,
  type ReaderProfile,
  type TrackCompletion,
} from "./progress";

type Snapshot = {
  profiles: ReaderProfile[];
  member: ReaderProfile | null;
  /** Reading without a profile: its own places and completion. */
  guest: GuestState;
  /** The active reader's completion: the member's, else the guest's. */
  completion: TrackCompletion;
  /** When the active reader's completed readings were marked done. */
  readOn: ReadOn;
  error: string;
  switches: number;
};

const listeners = new Set<() => void>();
let snapshot: Snapshot | undefined;

function read() {
  const state = loadProgress(localStorage);
  const member = state.profiles.find((p) => p.id === state.activeId) || null;
  return {
    profiles: state.profiles,
    member,
    guest: state.guest,
    completion: (member ?? state.guest).completion,
    readOn: (member ?? state.guest).readOn ?? {},
  };
}
function load(): Snapshot {
  try {
    // Commit a pending v1 migration; on failure it is retried next time.
    migrateProgress(localStorage);
    return { ...read(), error: "", switches: 0 };
  } catch (err) {
    return {
      profiles: [],
      member: null,
      guest: { track: "bible", places: {}, completion: emptyCompletion() },
      completion: emptyCompletion(),
      readOn: {},
      error: (err as Error).message,
      switches: 0,
    };
  }
}
function get() {
  return (snapshot ??= load());
}
function update(patch: Partial<Snapshot>) {
  snapshot = { ...get(), ...patch };
  listeners.forEach((listener) => listener());
}
function fail(err: unknown) {
  update({ error: (err as Error).message });
}
function act(run: () => unknown, switched = 0) {
  try {
    run();
    update({
      ...read(),
      error: "",
      switches: get().switches + switched,
    });
    return true;
  } catch (err) {
    fail(err);
    return false;
  }
}
function onStorage(event: StorageEvent) {
  if (event.key !== STATE_KEY && event.key !== PROGRESS_KEY && event.key)
    return;
  try {
    const next = read();
    update({
      ...next,
      switches: get().switches + Number(next.member?.id !== get().member?.id),
    });
  } catch (err) {
    fail(err);
  }
}
function subscribe(listener: () => void) {
  window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}

const actions = {
  select: (id: string | null) => act(() => selectReader(localStorage, id), 1),
  create: (name: string, start: string) =>
    act(() => createReader(localStorage, name, start), 1),
  restore: (text: string) => act(() => importBackup(localStorage, text), 1),
  complete: (id: string, day: number, done: boolean) =>
    act(() => setCompletion(localStorage, id, day, done)),
  /** Explicitly mark any track's reading done or not done ("" = guest). */
  completeReading: (id: string, location: AnyReadingLocation, done: boolean) =>
    act(() => setReadingCompletion(localStorage, id, location, done)),
  fail,
  clearError() {
    if (get().error) update({ error: "" });
  },
};

/**
 * Readers and their completion. Places come from `useReadingLocation`;
 * `member.places` is only as fresh as the last progress change.
 * `switches` counts changes of the active reader, including re-selecting the same one. */
export function useProgress() {
  return { ...useSyncExternalStore(subscribe, get), ...actions };
}
