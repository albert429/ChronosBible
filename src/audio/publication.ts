import { AUDIO_MAX_BYTES, AUDIO_MEDIA_PATTERN } from "./contract.ts";

/**
 * The verified upload inventory, `data/audio/publication.json`. Written only
 * by scripts/verify-audio-host.py after every file of a prepared release was
 * range-checked byte for byte on the deployed host. A file that is merely
 * prepared locally (`artifacts/r2-audio-inventory.json`) is not here.
 * Entries are never removed by verification, so an older release's media stay
 * in later staged releases for rollback; R2 objects are never deleted.
 */
export type PublishedFile = { bytes: number; sha256: string; release: string };
export type PublicationRelease = {
  id: string;
  verified: string;
  host: string;
  method: "ranges" | "full";
  files: number;
};
export type PublicationInventory = {
  version: 1;
  releases: PublicationRelease[];
  files: Record<string, PublishedFile>;
};

export function publicationErrors(data: unknown): string[] {
  if (!data || typeof data !== "object") return ["not an object"];
  const value = data as PublicationInventory;
  const errors: string[] = [];
  if (value.version !== 1) errors.push("version must be 1");
  if (!Array.isArray(value.releases)) errors.push("releases must be a list");
  const releases = new Set<string>();
  for (const release of Array.isArray(value.releases) ? value.releases : []) {
    if (
      !release ||
      typeof release.id !== "string" ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(release.id) ||
      typeof release.verified !== "string" ||
      Number.isNaN(Date.parse(release.verified)) ||
      typeof release.host !== "string" ||
      !["ranges", "full"].includes(release.method) ||
      !Number.isInteger(release.files) ||
      release.files < 1
    )
      errors.push(`invalid release ${JSON.stringify(release?.id)}`);
    else if (releases.has(release.id))
      errors.push(`duplicate release ${release.id}`);
    else releases.add(release.id);
  }
  if (!value.files || typeof value.files !== "object")
    return [...errors, "files must be an object"];
  for (const src of Object.keys(value.files)) {
    const file = value.files[src];
    if (
      !AUDIO_MEDIA_PATTERN.test(src) ||
      !file ||
      !Number.isInteger(file.bytes) ||
      file.bytes < 1 ||
      file.bytes > AUDIO_MAX_BYTES ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !releases.has(file.release)
    )
      errors.push(`invalid file ${src}`);
  }
  return errors;
}

/** Media paths verified on the host; an absent inventory publishes nothing. */
export function publishedMedia(inventory: unknown): Set<string> {
  if (inventory === undefined) return new Set();
  const errors = publicationErrors(inventory);
  if (errors.length)
    throw new Error(`Invalid audio publication inventory: ${errors[0]}`);
  return new Set(Object.keys((inventory as PublicationInventory).files));
}

/** Media a manifest needs: one src (v1/v2) or every playlist entry (v3). */
export function manifestMedia(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object") return [];
  const value = manifest as { src?: unknown; entries?: unknown };
  if (Array.isArray(value.entries))
    return value.entries.map((entry) => (entry as { src: string })?.src);
  return typeof value.src === "string" ? [value.src] : [];
}

/**
 * Which catalogued readings a build may advertise. `local` is media bundled in
 * this build's public/; a configured host additionally serves verified media.
 * Synthetic fixture hosts under the reserved `.test` TLD bypass the inventory.
 */
export function advertisedAudio({
  base,
  chaptersEnabled,
  days,
  chapters,
  readings,
  local,
  inventory,
}: {
  base: string;
  chaptersEnabled: boolean;
  days: { key: number; manifest: unknown }[];
  chapters: { key: string; manifest: unknown }[];
  readings: { key: string; manifest: unknown }[];
  local: (src: string) => boolean;
  inventory: unknown;
}) {
  const fixture = base !== "" && base !== "/" && isFixtureHost(base);
  const verified = publishedMedia(inventory);
  const hosted = (src: string) => base !== "" && (fixture || verified.has(src));
  const available = (manifest: unknown) => {
    const media = manifestMedia(manifest);
    return media.length > 0 && media.every((src) => local(src) || hosted(src));
  };
  // Days were published and verified before this inventory existed; a host
  // keeps advertising every prepared day as before.
  const advertisedDays = days
    .filter(({ manifest }) =>
      base ? true : manifestMedia(manifest).every(local),
    )
    .map(({ key }) => key);
  let advertisedChapters = chapters
    .filter(({ manifest }) => manifestMedia(manifest).every(local))
    .map(({ key }) => key);
  if (base && chaptersEnabled) {
    const missing = chapters.filter(({ manifest }) => !available(manifest));
    if (missing.length)
      throw new Error(
        `VITE_AUDIO_CHAPTERS_ENABLED=true, but ${missing.length} of ${chapters.length} chapter recordings are not in the verified upload inventory (data/audio/publication.json), e.g. ${missing[0].key}. Verify the deployed host first.`,
      );
    advertisedChapters = chapters.map(({ key }) => key);
  }
  const advertisedReadings = readings
    .filter(({ manifest }) => available(manifest))
    .map(({ key }) => key);
  return {
    days: advertisedDays,
    chapters: advertisedChapters,
    readings: advertisedReadings,
  };
}

export function isFixtureHost(base: string) {
  try {
    return new URL(base).hostname.endsWith(".test");
  } catch {
    return false;
  }
}

/** Published manifest JSON paths under the build output for advertised keys. */
export function manifestOutputPath(key: string | number) {
  if (typeof key === "number") return `audio/${key}.json`;
  const chapter = /^bible:([A-Z0-9]{3}):([1-9]\d{0,2})$/.exec(key);
  if (chapter) return `audio/chapters/${chapter[1]}/${chapter[2]}.json`;
  const reading = /^chrono:(OT|NT):([a-z0-9-]{1,40})$/.exec(key);
  if (reading) return `audio/chrono/${reading[1]}/${reading[2]}.json`;
  throw new Error(`Invalid audio key ${key}`);
}
