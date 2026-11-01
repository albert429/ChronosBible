/**
 * Listening positions by immutable media path, for the 20 most recent
 * recordings (`bible-reader-audio-position-v1`). Outside progress and backups.
 */
const POSITION_KEY = "bible-reader-audio-position-v1";
export function playbackPosition(identity: string): number {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "{}");
    const value = saved[identity];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : 0;
  } catch {
    return 0;
  }
}
export function savePlaybackPosition(identity: string, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "{}");
    const entries = Object.entries(
      saved && typeof saved === "object" ? saved : {},
    )
      .filter(([key]) => key !== identity)
      .slice(-19);
    localStorage.setItem(
      POSITION_KEY,
      JSON.stringify({ ...Object.fromEntries(entries), [identity]: seconds }),
    );
  } catch {
    /* Reading remains usable when storage is blocked. */
  }
}
