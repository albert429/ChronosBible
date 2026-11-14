import { manifestKey } from "./identity.ts";
import type {
  Announcement,
  AudioManifest,
  AudioManifestV2,
  Cue,
  LegacyAudioManifest,
} from "./types.ts";

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
/**
 * Where previous/next verse seeks to (the player's buttons and the lock
 * screen's track skips): the start of the stepped verse, kept inside the
 * reading. Undefined without verse timing.
 */
export function stepCueStart(manifest: Timed, time: number, step: number) {
  const { cues } = manifest;
  if (!cues.length) return undefined;
  const index = stepCueIndex(manifest, time, step);
  return cues[Math.max(0, Math.min(index, cues.length - 1))].start;
}
