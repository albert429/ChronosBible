import { useLayoutEffect, useRef, type RefObject } from "react";
import { CHIPS } from "./domain/chips.ts";
import type { ChipId } from "./domain/types.ts";
import type { View } from "./request.ts";

/** Restore focus when the control holding it is replaced by request state. */
export function useAiFocus(
  on: boolean,
  view: View,
  lastChip: RefObject<ChipId | null>,
) {
  // Focus targets for when the focused control disappears (see below).
  const root = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const chipButtons = useRef<Partial<Record<ChipId, HTMLButtonElement | null>>>(
    {},
  );
  const askButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const anotherButton = useRef<HTMLButtonElement>(null);
  const reportLink = useRef<HTMLAnchorElement>(null);
  const turnOnButton = useRef<HTMLButtonElement>(null);
  // A control that unmounts while focused («إيقاف» when the answer ends, a
  // button replaced by its result) would drop focus to <body> inside the modal
  // sheet. Move it to the control that took its place instead.
  useLayoutEffect(() => {
    const lost = lastFocus.current;
    if (!lost || lost.isConnected) return;
    lastFocus.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && !active.contains(root.current))
      return;
    const chip = view.s === "idle" ? lastChip.current : view.chip;
    const target = !on
      ? turnOnButton.current
      : (stopButton.current ??
        retryButton.current ??
        anotherButton.current ??
        reportLink.current ??
        (chip === "ask"
          ? askButton.current
          : chip
            ? chipButtons.current[chip]
            : null) ??
        chipButtons.current[CHIPS[0].id]);
    target?.focus({ preventScroll: true });
  });

  return {
    root,
    lastFocus,
    chipButtons,
    askButton,
    stopButton,
    retryButton,
    anotherButton,
    reportLink,
    turnOnButton,
  };
}
