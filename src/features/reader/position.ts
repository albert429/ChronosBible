/**
 * The top visible verse of the 50 most recent readings
 * (`bible-reader-scroll-v1`), for restoring a place. Outside progress and
 * backups; blocked storage only loses the position.
 */
/** Where a reader was in each recent reading: its top visible verse. */
export type ReadingPosition = {
  passage: number;
  verse: number;
  /** How far down that verse the view began, in thousandths of its height. */
  offset: number;
};
const SCROLL_KEY = "bible-reader-scroll-v1";
const SCROLL_LIMIT = 50;
const validPosition = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => Number.isSafeInteger(n) && n >= 0) &&
  value[2] <= 1000;
function savedPositions(): Record<string, unknown> {
  try {
    const saved = JSON.parse(localStorage.getItem(SCROLL_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? saved
      : {};
  } catch {
    return {};
  }
}
export function readingPosition(identity: string): ReadingPosition | undefined {
  const value = savedPositions()[identity];
  return validPosition(value)
    ? { passage: value[0], verse: value[1], offset: value[2] }
    : undefined;
}
/** Remembers a position; none (the reading's start) forgets it. */
export function saveReadingPosition(
  identity: string,
  position: ReadingPosition | undefined,
) {
  const saved = savedPositions();
  if (!position && !(identity in saved)) return;
  const entries = Object.entries(saved)
    .filter(([key]) => key !== identity)
    .slice(-(SCROLL_LIMIT - 1));
  if (position)
    entries.push([
      identity,
      [position.passage, position.verse, position.offset],
    ]);
  try {
    localStorage.setItem(
      SCROLL_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    /* Reading remains usable when storage is blocked. */
  }
}
