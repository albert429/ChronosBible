// Inlined by vite.config.ts: a content hash of each public data folder
// (bible, readings, chronology, study). Absent outside a Vite build.
declare const __DATA_VERSIONS__: Record<string, string>;
const versions: Record<string, string> =
  typeof __DATA_VERSIONS__ === "undefined" ? {} : __DATA_VERSIONS__;

/** A data folder's content version, or "" when it is not versioned. */
export const dataVersion = (folder: string) => versions[folder] ?? "";

/**
 * A data file's address, named by its folder's content version: hosting may
 * then cache it for good, and any change to that folder gets new addresses.
 */
export function dataUrl(path: string) {
  const version = dataVersion(path.split("/")[1]);
  return version ? `${path}?v=${version}` : path;
}
