import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { AnyScriptureReading } from "../bible/types";
import { connectionAllowsPrefetch } from "../lib/network";
import { loadStudyPanel, type StudyTarget } from "../study/VerseStudy";
import {
  clearSelected,
  closestVerse,
  isVerseNumber,
  markSelected,
  verseLocation,
} from "./scriptureDom";

export function useVerseTap(reading: AnyScriptureReading | undefined) {
  const [target, setTarget] = useState<StudyTarget | null>(null);
  const [open, setOpen] = useState(false);
  const press = useRef<{ t: number; x: number; y: number; selection: boolean }>(
    null,
  );
  const warmed = useRef(false);

  function onPointerDown(event: PointerEvent) {
    press.current = {
      t: performance.now(),
      x: event.clientX,
      y: event.clientY,
      selection: !(getSelection()?.isCollapsed ?? true),
    };
    if (!warmed.current) {
      warmed.current = true;
      // Warm the code chunk only; study data loads when a verse opens.
      if (connectionAllowsPrefetch()) void loadStudyPanel().catch(() => {});
    }
  }

  // A plain tap on a verse opens its study sheet; selecting, long-pressing or
  // dragging to read does not. Keyboard users activate the verse number.
  function onClick(event: MouseEvent) {
    const verseEl = closestVerse(event.target);
    if (!verseEl || !reading) return;
    if (event.detail === 0) {
      if (!isVerseNumber(event.target)) return;
    } else {
      const start = press.current;
      press.current = null;
      if (
        !start ||
        start.selection ||
        !(getSelection()?.isCollapsed ?? true) ||
        performance.now() - start.t > 500 ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
      )
        return;
    }
    const location = verseLocation(verseEl);
    if (!location) return;
    markSelected(verseEl);
    setTarget({ ...location, el: verseEl });
    setOpen(true);
  }

  return {
    target,
    open,
    onPointerDown,
    onClick,
    close: () => setOpen(false),
    reset: () => {
      setTarget(null);
      setOpen(false);
    },
    afterClose: () => {
      if (target) clearSelected(target.el);
    },
  };
}
