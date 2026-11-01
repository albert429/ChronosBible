import {
  isChronologicalReading,
  type ScriptureReading,
} from "../reading/types.ts";
import { readingKey } from "../reading/identity.ts";
import { catalog } from "../scripture/catalog.ts";
import { readingTranscript, validManifest } from "./manifest.ts";
import type { AudioManifest, AudioManifestV3 } from "./types.ts";

/**
 * Whether a valid manifest fits the reading on screen: its identity, its
 * passages and cues, and the SHA-256 of the displayed transcript. A changed
 * text or chronology makes a manifest stale and the player refuses it.
 */

/** Hex SHA-256 of `readingTranscript` (Web Crypto, also available in Node). */
export async function readingHash(reading: ScriptureReading) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(readingTranscript(reading)),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Each entry must be exactly the reading's passage, in order. */
function entriesMatch(manifest: AudioManifestV3, reading: ScriptureReading) {
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

/** Single-file cues name every displayed verse in order (unless chapter-timed). */
function cuesMatch(
  manifest: Exclude<AudioManifest, AudioManifestV3>,
  reading: ScriptureReading,
) {
  const expected = reading.passages.flatMap((p, passage) =>
    p.verses.map((v) => ({ passage, verse: v.number })),
  );
  return (
    ((manifest.version === 2 && manifest.alignment === "chapter") ||
      (manifest.cues.length === expected.length &&
        expected.every(
          (v, i) =>
            v.passage === manifest.cues[i].passage &&
            v.verse === manifest.cues[i].verse,
        ))) &&
    (manifest.version !== 2 ||
      manifest.announcements.every((a) => a.passage < reading.passages.length))
  );
}

export async function matchesReading(
  manifest: AudioManifest,
  reading: ScriptureReading,
) {
  if (!validManifest(manifest, readingKey(reading))) return false;
  if (
    manifest.version === 3
      ? !isChronologicalReading(reading) || !entriesMatch(manifest, reading)
      : !cuesMatch(manifest, reading)
  )
    return false;
  return manifest.readingHash === (await readingHash(reading));
}
