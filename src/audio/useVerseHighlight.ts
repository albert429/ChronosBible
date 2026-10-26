import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearListening,
  markListening,
  verseElement,
} from "../reader/scriptureDom";
import { scrollDelta } from "./highlightScroll.ts";
import type { Cue } from "./manifest";

/** After the reader scrolls by hand, the text stays put this long. */
const HANDS_OFF = 8000;
const SCROLL_KEYS = new Set([
  " ",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "ArrowUp",
  "ArrowDown",
]);

function keepInView(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const delta = scrollDelta({
    verseTop: rect.top,
    verseBottom: rect.bottom,
    topbarBottom: document.querySelector(".topbar")?.getBoundingClientRect()
      .bottom,
    playerTop: document.querySelector(".audio-player")?.getBoundingClientRect()
      .top,
    viewportHeight: innerHeight,
  });
  if (delta !== null) window.scrollBy({ top: delta, behavior: "instant" });
}

/**
 * Mark the verse being read, and keep it in view while audio plays, unless
 * the reader has just scrolled away by hand: then the text waits, and
 * `detached` offers a way back, until a later verse finds them idle again.
 */
export function useVerseHighlight(cue: Cue | undefined, playing: boolean) {
  const manual = useRef(-Infinity);
  const [detached, setDetached] = useState(false);
  useEffect(() => {
    if (!playing) return;
    // Wheel, touch and scrolling keys only: the player's own scrolling
    // fires none of them. All passive, so scrolling never waits on this.
    const away = () => {
      manual.current = performance.now();
      setDetached(true);
    };
    const key = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) away();
    };
    addEventListener("wheel", away, { passive: true });
    addEventListener("touchmove", away, { passive: true });
    addEventListener("keydown", key, { passive: true });
    return () => {
      removeEventListener("wheel", away);
      removeEventListener("touchmove", away);
      removeEventListener("keydown", key);
    };
  }, [playing]);
  useEffect(() => {
    const element = cue ? verseElement(cue.passage, cue.verse) : null;
    if (!element) return;
    markListening(element);
    if (playing && performance.now() - manual.current >= HANDS_OFF) {
      setDetached(false);
      keepInView(element);
    }
    return () => clearListening(element);
  }, [cue, playing]);
  /** Follow again from the next verse on (after a seek, for example). */
  const resume = useCallback(() => {
    manual.current = -Infinity;
    setDetached(false);
  }, []);
  /** Follow again, bringing the verse being read back into view now. */
  const follow = useCallback(() => {
    resume();
    const element = document.querySelector<HTMLElement>(
      ".verse[data-listening]",
    );
    if (element) keepInView(element);
  }, [resume]);
  return { detached: detached && playing, follow, resume };
}
