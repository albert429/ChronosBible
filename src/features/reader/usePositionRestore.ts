import { useLayoutEffect } from "react";
import type { ScriptureReading } from "../../domain/reading/types";
import {
  clearSelected,
  markSelected,
  verseElement,
  verseNumberButton,
} from "../../shared/browser/scriptureDom";
import { scrollToVerse } from "./verseScroll";
import { readingPosition } from "./position";

/** What a reader does to move the page themselves. */
const INPUT_EVENTS = ["pointerdown", "wheel", "keydown"] as const;

/**
 * A linked verse number's passage: a chronological link names a verse number
 * but not its occurrence, so the first passage that contains it (canonical
 * links have one passage).
 */
export const linkedPassage = (reading: ScriptureReading, verse: number) =>
  Math.max(
    0,
    reading.passages.findIndex(
      (item) => verse >= item.start && verse <= item.end,
    ),
  );

/**
 * Places the page for each navigation: a linked verse is focused, scrolled to
 * and marked until the reader next touches the page; otherwise, when
 * `restore` asks for it, the remembered position, else the top. Placement is
 * repeated once fonts settle unless the reader has moved the page since.
 */
export function usePositionRestore({
  current,
  identity,
  verse,
  navigation,
  restore,
}: {
  /** The reading on screen, once it matches `identity`. */
  current: ScriptureReading | undefined;
  identity: string;
  verse: number | undefined;
  navigation: number;
  restore: boolean;
}) {
  useLayoutEffect(() => {
    let target: HTMLElement | null;
    let offset: number | undefined;
    let clear: (() => void) | undefined;
    if (!verse) {
      const saved = restore && current && readingPosition(identity);
      target = saved ? verseElement(saved.passage, saved.verse) : null;
      offset = saved ? saved.offset : undefined;
      if (!target) {
        window.scrollTo({ top: 0, behavior: "instant" });
        return;
      }
      scrollToVerse(target, offset);
    } else {
      if (!current) return;
      target = verseElement(linkedPassage(current, verse), verse);
      if (!target) return;
      verseNumberButton(target)?.focus({ preventScroll: true });
      scrollToVerse(target);
      // The linked verse stays marked until the reader next touches the page.
      const marked = target;
      markSelected(marked);
      clear = () => clearSelected(marked);
      document.addEventListener("pointerdown", clear, { once: true });
    }
    // The text can arrive before its fonts (it is fetched with the page), and
    // their swap reflows it: place it again once they settle, unless the
    // reader has touched the page since. The swap itself can move the scroll
    // (a shorter page clamps it), so only the reader's own input counts.
    const placed = target;
    let active = true;
    const stop = () => {
      active = false;
      for (const type of INPUT_EVENTS)
        removeEventListener(type, stop, { capture: true });
    };
    if (document.fonts?.status === "loading") {
      for (const type of INPUT_EVENTS)
        addEventListener(type, stop, { capture: true, passive: true });
      void document.fonts.ready.then(() => {
        if (active) scrollToVerse(placed, offset);
        stop();
      });
    }
    return () => {
      stop();
      if (clear) {
        document.removeEventListener("pointerdown", clear);
        clear();
      }
    };
  }, [current, identity, verse, navigation, restore]);
}
