import { useRef, type TouchEvent } from "react";

const DISTANCE = 60;
const DURATION = 600;
/** Swipes from the screen edges belong to the system (Back on iOS). */
const EDGE = 24;

/**
 * A quick horizontal swipe over the text turns the page: rightward to the
 * next reading, as an Arabic book's pages turn, leftward to the previous one.
 * Scrolling, zoomed panning, pinching and selecting text are left alone, and
 * React's touch listeners are passive, so scrolling never waits on this.
 */
export function useSwipePaging(turn: (direction: -1 | 1) => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    start.current =
      event.touches.length === 1 &&
      touch.clientX > EDGE &&
      touch.clientX < innerWidth - EDGE &&
      (visualViewport?.scale ?? 1) <= 1
        ? { x: touch.clientX, y: touch.clientY, t: event.timeStamp }
        : null;
  }
  function onTouchEnd(event: TouchEvent) {
    const from = start.current;
    start.current = null;
    const touch = event.changedTouches[0];
    if (!from || !touch || event.touches.length) return;
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    if (
      Math.abs(dx) < DISTANCE ||
      Math.abs(dx) < 2 * Math.abs(dy) ||
      event.timeStamp - from.t > DURATION ||
      !(getSelection()?.isCollapsed ?? true)
    )
      return;
    turn(dx > 0 ? 1 : -1);
  }
  return {
    onTouchStart,
    onTouchEnd,
    onTouchCancel: () => {
      start.current = null;
    },
  };
}
