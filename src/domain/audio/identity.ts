import { isChronologyId } from "../reading/chronology.ts";

/**
 * Recording addresses. A reading key (`readingKey`) names its recording: a
 * plan day (`plan:12`, or the legacy bare `12`), a canonical chapter
 * (`bible:PSA:119`) or a chronological playlist (`chrono:OT:<id>`).
 */
export function manifestKey(key: string) {
  return /^\d+$/.test(key) ? `plan:${Number(key)}` : key;
}

export type AudioAddress =
  /** `day` keeps the digits as written; validation decides which are valid. */
  | { kind: "plan"; day: string }
  | { kind: "chapter"; book: string; chapter: number }
  | { kind: "reading"; testament: "OT" | "NT"; id: string };

const PLAN_KEY = /^plan:(\d+)$/;
const CHAPTER_KEY = /^bible:([A-Z0-9]{3}):([1-9]\d{0,2})$/;
const CHRONO_KEY = /^chrono:(OT|NT):(.+)$/;

/** What an identity (after `manifestKey`) addresses, or null. */
export function audioAddress(identity: string): AudioAddress | null {
  const day = PLAN_KEY.exec(identity);
  if (day) return { kind: "plan", day: day[1] };
  const chapter = CHAPTER_KEY.exec(identity);
  if (chapter)
    return { kind: "chapter", book: chapter[1], chapter: Number(chapter[2]) };
  const reading = CHRONO_KEY.exec(identity);
  return reading && isChronologyId(reading[2])
    ? { kind: "reading", testament: reading[1] as "OT" | "NT", id: reading[2] }
    : null;
}

/** The published manifest for a reading key; throws on anything else. */
export function audioManifestUrl(key: string) {
  const address = audioAddress(manifestKey(key));
  switch (address?.kind) {
    case "plan":
      return `/audio/${Number(address.day)}.json`;
    case "chapter":
      return `/audio/chapters/${address.book}/${address.chapter}.json`;
    case "reading":
      return `/audio/chrono/${address.testament}/${address.id}.json`;
  }
  throw new Error("Invalid audio reading identity.");
}
