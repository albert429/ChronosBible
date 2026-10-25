import {
  isChronologicalReading,
  readingKey,
  type AnyScriptureReading,
} from "../bible/types.ts";
import { catalog } from "../bible/catalog.ts";
import { isChronologyId } from "../chronology/types.ts";
import { AUDIO_MEDIA_PATTERN } from "./contract.ts";

export type Cue = {
  passage: number;
  verse: number;
  start: number;
  end: number;
};
export type Announcement = {
  passage: number;
  start: number;
  end: number;
  reference: string;
  kind: "reference" | "source";
};
type MediaManifest = {
  readingHash: string;
  src: string;
  duration: number;
  cues: Cue[];
};
export type LegacyAudioManifest = MediaManifest & { version: 1; day: number };
export type AudioManifestV2 = MediaManifest & {
  version: 2;
  identity: string;
  day?: number;
  book?: string;
  chapter?: number;
  /** Chapter timing deliberately supplies no invented verse cues. */
  alignment: "verse" | "chapter";
  announcements: Announcement[];
};
/**
 * One passage of a version-3 playlist: a whole canonical chapter recording
 * (reused as is) or a clip cut offline from the original recording at
 * reviewed verse boundaries. Times are local to this entry's file.
 */
export type PlaylistEntryManifest = {
  passage: number;
  /** USFM book code. */
  book: string;
  chapter: number;
  from: number;
  to: number;
  src: string;
  duration: number;
  alignment: "verse" | "chapter";
  cues: { verse: number; start: number; end: number }[];
  /** Only a full chapter's own spoken opening, before its first verse. */
  announcements: {
    start: number;
    end: number;
    reference: string;
    kind: "source";
  }[];
};
/** A chronological reading: several files played in order on one timeline. */
export type AudioManifestV3 = {
  version: 3;
  identity: string;
  readingHash: string;
  /** Sum of the entry durations. */
  duration: number;
  entries: PlaylistEntryManifest[];
};
export type AudioManifest =
  LegacyAudioManifest | AudioManifestV2 | AudioManifestV3;

// This exact representation is also used by the offline audio builder.
export function readingTranscript(reading: AnyScriptureReading) {
  return JSON.stringify(
    reading.passages.map((p) => [
      p.book,
      p.chapter,
      p.start,
      p.end,
      p.verses?.map((v) => [v.number, v.text]),
    ]),
  );
}
export async function readingHash(reading: AnyScriptureReading) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(readingTranscript(reading)),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function audioReadingKey(reading: AnyScriptureReading) {
  return readingKey(reading);
}
export function manifestKey(key: string) {
  return /^\d+$/.test(key) ? `plan:${Number(key)}` : key;
}
const CHAPTER_KEY = /^bible:([A-Z0-9]{3}):([1-9]\d{0,2})$/;
const CHRONO_KEY = /^chrono:(OT|NT):(.+)$/;
function chronoKey(identity: string) {
  const match = CHRONO_KEY.exec(identity);
  return match && isChronologyId(match[2])
    ? { testament: match[1], id: match[2] }
    : null;
}
export function audioManifestUrl(key: string) {
  const identity = manifestKey(key);
  const day = /^plan:(\d+)$/.exec(identity);
  if (day) return `/audio/${Number(day[1])}.json`;
  const chapter = CHAPTER_KEY.exec(identity);
  if (chapter) return `/audio/chapters/${chapter[1]}/${chapter[2]}.json`;
  const reading = chronoKey(identity);
  if (reading) return `/audio/chrono/${reading.testament}/${reading.id}.json`;
  throw new Error("Invalid audio reading identity.");
}

const time = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const positive = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 1;
/** Ordered, non-overlapping intervals inside [0, duration]. */
function intervals(
  items: { start: number; end: number }[],
  duration: number,
): boolean {
  return items.every(
    (item, index) =>
      !!item &&
      typeof item === "object" &&
      time(item.start) &&
      time(item.end) &&
      item.start < item.end &&
      item.end <= duration + 0.1 &&
      (index === 0 || item.start >= items[index - 1].end),
  );
}
function validAnnouncements(
  announcements: unknown,
  cues: { start: number; end: number }[],
  duration: number,
  kinds: string[],
) {
  return (
    Array.isArray(announcements) &&
    intervals(announcements, duration) &&
    announcements.every(
      (a) =>
        (a.passage === undefined ||
          (Number.isInteger(a.passage) && a.passage >= 0)) &&
        typeof a.reference === "string" &&
        a.reference.trim().length > 0 &&
        a.reference.length <= 500 &&
        kinds.includes(a.kind) &&
        cues.every((cue) => a.end <= cue.start || a.start >= cue.end),
    )
  );
}

function validEntry(entry: PlaylistEntryManifest, index: number) {
  if (!entry || typeof entry !== "object") return false;
  const { book, chapter, from, to, src } = entry;
  if (
    entry.passage !== index ||
    typeof book !== "string" ||
    !/^[A-Z0-9]{3}$/.test(book) ||
    !positive(chapter) ||
    !positive(from) ||
    !positive(to) ||
    from > to ||
    typeof src !== "string" ||
    !AUDIO_MEDIA_PATTERN.test(src) ||
    !(
      src.startsWith(`/audio/chapters/assets/${book}-${chapter}-`) ||
      src.startsWith(`/audio/clips/${book}-${chapter}-${from}-${to}-`)
    ) ||
    !Number.isFinite(entry.duration) ||
    entry.duration <= 0 ||
    !["verse", "chapter"].includes(entry.alignment) ||
    !Array.isArray(entry.cues)
  )
    return false;
  if (
    entry.alignment === "verse"
      ? entry.cues.length !== to - from + 1 ||
        !entry.cues.every((cue, i) => cue?.verse === from + i)
      : entry.cues.length !== 0
  )
    return false;
  return (
    intervals(entry.cues, entry.duration) &&
    validAnnouncements(entry.announcements, entry.cues, entry.duration, [
      "source",
    ])
  );
}

function validPlaylist(m: AudioManifestV3, identity: string) {
  return (
    m.identity === identity &&
    Array.isArray(m.entries) &&
    m.entries.length >= 1 &&
    m.entries.length <= 200 &&
    m.entries.every(validEntry) &&
    Math.abs(m.entries.reduce((sum, e) => sum + e.duration, 0) - m.duration) <=
      0.5
  );
}

export function validManifest(
  data: unknown,
  key: string,
): data is AudioManifest {
  if (!data || typeof data !== "object") return false;
  const m = data as AudioManifest;
  const identity = manifestKey(key);
  const plan = /^plan:([1-9]\d{0,2})$/.exec(identity);
  const chapter = CHAPTER_KEY.exec(identity);
  const reading = chronoKey(identity);
  if (
    (plan && Number(plan[1]) > 150) ||
    (!plan && !chapter && !reading) ||
    ![1, 2, 3].includes(m.version) ||
    !/^[a-f0-9]{64}$/.test(m.readingHash) ||
    !Number.isFinite(m.duration) ||
    m.duration <= 0
  )
    return false;
  if (reading || m.version === 3)
    return !!reading && m.version === 3 && validPlaylist(m, identity);
  if (
    typeof m.src !== "string" ||
    !AUDIO_MEDIA_PATTERN.test(m.src) ||
    !Array.isArray(m.cues)
  )
    return false;
  if (plan) {
    if (
      m.day !== Number(plan[1]) ||
      !m.src.startsWith(`/audio/days/${plan[1].padStart(3, "0")}-`)
    )
      return false;
  } else if (
    m.version !== 2 ||
    m.book !== chapter![1] ||
    m.chapter !== Number(chapter![2]) ||
    !m.src.startsWith(`/audio/chapters/assets/${chapter![1]}-${chapter![2]}-`)
  )
    return false;
  if (m.version === 1) {
    if (!m.cues.length) return false;
  } else if (
    m.identity !== identity ||
    !["verse", "chapter"].includes(m.alignment) ||
    (m.alignment === "verse" ? !m.cues.length : m.cues.length !== 0)
  )
    return false;
  if (
    !intervals(m.cues, m.duration) ||
    !m.cues.every(
      (cue) =>
        Number.isInteger(cue.passage) &&
        cue.passage >= 0 &&
        Number.isInteger(cue.verse) &&
        cue.verse >= 1,
    )
  )
    return false;
  // Never interpret unvalidated extension fields on a version-one manifest.
  return (
    m.version === 1 ||
    (validAnnouncements(m.announcements, m.cues, m.duration, [
      "reference",
      "source",
    ]) &&
      m.announcements.every((a) => Number.isInteger(a.passage)))
  );
}

/** Each entry must be exactly the reading's passage, in order. */
function entriesMatch(manifest: AudioManifestV3, reading: AnyScriptureReading) {
  return (
    manifest.entries.length === reading.passages.length &&
    manifest.entries.every((entry, index) => {
      const passage = reading.passages[index];
      const book = catalog.find((b) => b.usfm === entry.book);
      const verses = book?.verseCounts[entry.chapter - 1];
      return (
        !!book &&
        verses !== undefined &&
        passage.book === book.name &&
        passage.chapter === entry.chapter &&
        passage.start === entry.from &&
        passage.end === entry.to &&
        entry.to <= verses &&
        // A whole-chapter recording may only stand for the whole chapter.
        (!entry.src.startsWith("/audio/chapters/") ||
          (entry.from === 1 && entry.to === verses)) &&
        passage.verses.length === entry.to - entry.from + 1 &&
        passage.verses.every((v, i) => v.number === entry.from + i)
      );
    })
  );
}

export async function matchesReading(
  manifest: AudioManifest,
  reading: AnyScriptureReading,
) {
  const key = audioReadingKey(reading);
  if (!validManifest(manifest, key)) return false;
  if (manifest.version === 3) {
    if (!isChronologicalReading(reading) || !entriesMatch(manifest, reading))
      return false;
  } else {
    const expected = reading.passages.flatMap((p, passage) =>
      p.verses.map((v) => ({ passage, verse: v.number })),
    );
    if (
      !(
        (manifest.version === 2 && manifest.alignment === "chapter") ||
        (manifest.cues.length === expected.length &&
          expected.every(
            (v, i) =>
              v.passage === manifest.cues[i].passage &&
              v.verse === manifest.cues[i].verse,
          ))
      ) ||
      (manifest.version === 2 &&
        !manifest.announcements.every(
          (a) => a.passage < reading.passages.length,
        ))
    )
      return false;
  }
  return manifest.readingHash === (await readingHash(reading));
}

/** One file on the reading's timeline. */
export type TimelineEntry = {
  src: string;
  duration: number;
  /** Start of this file on the reading timeline, in seconds. */
  offset: number;
  /** Index of this entry's first cue in `Timeline.cues`. */
  firstCue: number;
  cueCount: number;
  alignment: "verse" | "chapter";
};
/**
 * Every manifest version as one timeline: v1/v2 are a single entry; v3
 * entries follow each other. Cues and announcements use timeline seconds.
 */
export type Timeline = {
  identity: string;
  /** Stable resume key: the media path for one file, else the playlist. */
  source: string;
  duration: number;
  entries: TimelineEntry[];
  cues: Cue[];
  announcements: Announcement[];
};

/** Short, stable fingerprint (FNV-1a, 32 bits) for resume keys. */
function fingerprint(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function toTimeline(manifest: AudioManifest, key: string): Timeline {
  const identity = manifestKey(key);
  if (manifest.version !== 3)
    return {
      identity,
      source: manifest.src,
      duration: manifest.duration,
      entries: [
        {
          src: manifest.src,
          duration: manifest.duration,
          offset: 0,
          firstCue: 0,
          cueCount: manifest.cues.length,
          alignment:
            manifest.version === 2 ? manifest.alignment : ("verse" as const),
        },
      ],
      cues: manifest.cues,
      // Never interpret unvalidated extension fields on a version-one manifest.
      announcements: manifest.version === 2 ? manifest.announcements : [],
    };
  const entries: TimelineEntry[] = [];
  const cues: Cue[] = [];
  const announcements: Announcement[] = [];
  let offset = 0;
  for (const entry of manifest.entries) {
    entries.push({
      src: entry.src,
      duration: entry.duration,
      offset,
      firstCue: cues.length,
      cueCount: entry.cues.length,
      alignment: entry.alignment,
    });
    for (const cue of entry.cues)
      cues.push({
        passage: entry.passage,
        verse: cue.verse,
        start: offset + cue.start,
        end: offset + cue.end,
      });
    for (const a of entry.announcements)
      announcements.push({
        ...a,
        passage: entry.passage,
        start: offset + a.start,
        end: offset + a.end,
      });
    offset += entry.duration;
  }
  return {
    identity,
    source: `playlist:${identity}:${fingerprint(entries.map((e) => e.src).join("|"))}`,
    duration: offset,
    entries,
    cues,
    announcements,
  };
}

/** The entry playing at a timeline time (the last one at or past the end). */
export function entryAt(timeline: Pick<Timeline, "entries">, seconds: number) {
  let index = 0;
  while (
    index < timeline.entries.length - 1 &&
    seconds >= timeline.entries[index + 1].offset
  )
    index += 1;
  return index;
}

// Keep the current verse selected during the brief silence before the next.
export function cueAt(
  cues: Cue[],
  time: number,
  low = 0,
  high = cues.length - 1,
) {
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (cues[mid].start <= time) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** A single-file manifest, or any manifest as a timeline (v3 needs one). */
type Timed = LegacyAudioManifest | AudioManifestV2 | Timeline;
const announcementsOf = (m: Timed): Announcement[] =>
  "source" in m || m.version === 2 ? m.announcements : [];
const timelineOf = (m: Timed): Timeline | undefined =>
  "source" in m ? m : undefined;

export function announcementAt(manifest: Timed, time: number) {
  return announcementsOf(manifest).find((a) => time >= a.start && time < a.end);
}
/**
 * The verse being read, or -1 with no verse timing or during an explicit
 * opening or spoken reference. As before references existed, a brief
 * unannounced lead-in already shows the first verse of that file.
 */
export function activeCueIndex(manifest: Timed, time: number) {
  const timeline = timelineOf(manifest);
  const { cues } = manifest;
  if (!cues.length || announcementAt(manifest, time)) return -1;
  if (!timeline) return cueAt(cues, time);
  const entry = timeline.entries[entryAt(timeline, time)];
  if (!entry.cueCount) return -1;
  return cueAt(cues, time, entry.firstCue, entry.firstCue + entry.cueCount - 1);
}
/** During an opening or passage reference, next verse goes to the upcoming verse. */
export function stepCueIndex(manifest: Timed, time: number, step: number) {
  const { cues } = manifest;
  const active = activeCueIndex(manifest, time);
  if (active >= 0) return active + step;
  const upcoming = cues.findIndex((cue) => cue.start >= time);
  return step > 0
    ? upcoming < 0
      ? cues.length - 1
      : upcoming
    : upcoming < 0
      ? cues.length - 1
      : upcoming - 1;
}
