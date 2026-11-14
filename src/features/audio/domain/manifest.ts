import type { ScriptureReading } from "../../../core/reading/types.ts";
import { AUDIO_MEDIA_PATTERN } from "./contract.ts";
import { audioAddress, manifestKey } from "./identity.ts";
import type {
  AudioManifest,
  AudioManifestV3,
  PlaylistEntryManifest,
} from "./types.ts";

/**
 * The manifest file contract shared with the build (scripts/data/build-audio-index.js)
 * and the offline Python builders: the transcript a manifest's `readingHash`
 * fingerprints, and the structure a published file must have. Whether a valid
 * manifest fits the text on screen is compatibility.ts.
 */

// This exact representation is also used by the offline audio builder.
export function readingTranscript(reading: ScriptureReading) {
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

/** Whether `data` is a well-formed manifest of the recording `key` names. */
export function validManifest(
  data: unknown,
  key: string,
): data is AudioManifest {
  if (!data || typeof data !== "object") return false;
  const m = data as AudioManifest;
  const identity = manifestKey(key);
  const address = audioAddress(identity);
  // Plan days are 1-150, written without leading zeros.
  const day =
    address?.kind === "plan" && /^[1-9]\d{0,2}$/.test(address.day)
      ? address.day
      : undefined;
  const chapter = address?.kind === "chapter" ? address : undefined;
  const reading = address?.kind === "reading";
  if (
    (day && Number(day) > 150) ||
    (!day && !chapter && !reading) ||
    ![1, 2, 3].includes(m.version) ||
    !/^[a-f0-9]{64}$/.test(m.readingHash) ||
    !Number.isFinite(m.duration) ||
    m.duration <= 0
  )
    return false;
  if (reading || m.version === 3)
    return reading && m.version === 3 && validPlaylist(m, identity);
  if (
    typeof m.src !== "string" ||
    !AUDIO_MEDIA_PATTERN.test(m.src) ||
    !Array.isArray(m.cues)
  )
    return false;
  if (day) {
    if (
      m.day !== Number(day) ||
      !m.src.startsWith(`/audio/days/${day.padStart(3, "0")}-`)
    )
      return false;
  } else if (
    m.version !== 2 ||
    m.book !== chapter!.book ||
    m.chapter !== chapter!.chapter ||
    !m.src.startsWith(
      `/audio/chapters/assets/${chapter!.book}-${chapter!.chapter}-`,
    )
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
