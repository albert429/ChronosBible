const TOPBAR_FALLBACK = 60;
const TOP_MARGIN = 16;
const BOTTOM_MARGIN = 24;

export type ScrollInput = {
  verseTop: number;
  verseBottom: number;
  /** Bottom edge of the top bar, if it is on screen. */
  topbarBottom?: number;
  /** Top edge of the audio player, if it is on screen. */
  playerTop?: number;
  viewportHeight: number;
};

/** How far to scroll so the verse sits between the top bar and the player, or null if it already does. */
export function scrollDelta({
  verseTop,
  verseBottom,
  topbarBottom,
  playerTop,
  viewportHeight,
}: ScrollInput) {
  const top = (topbarBottom || TOPBAR_FALLBACK) + TOP_MARGIN;
  const bottom = playerTop || viewportHeight;
  if (verseTop < top || verseBottom > bottom - BOTTOM_MARGIN)
    return verseTop - top;
  return null;
}
