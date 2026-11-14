/** Pure profile, guest and backup contracts for all reading tracks. */
import type { ReaderPlaces } from "../../../core/reading/places.ts";

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
export type Completed = { completion: TrackCompletion; readOn?: ReadOn };
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
