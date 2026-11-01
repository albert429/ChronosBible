/**
 * The published timing manifests: version 1 (a plan day), version 2 (a plan
 * day or canonical chapter with explicit alignment and announcements) and
 * version 3 (a chronological playlist). Shapes only; validation is in
 * manifest.ts and reading compatibility in compatibility.ts.
 */
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
