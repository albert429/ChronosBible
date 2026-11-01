import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReadingLocation } from "../domain/reading/types";
import type { View } from "../features/navigation/model";
import { pagingTarget } from "./keyboardPaging";

/** Arrow keys page the reading (see `pagingTarget`), not the calendar. */
export function useKeyboardPaging(session: {
  view: View;
  previous?: ReadingLocation;
  next?: ReadingLocation;
  actions: { go: (location: ReadingLocation) => void };
}) {
  const latest = useRef(session);
  useLayoutEffect(() => {
    latest.current = session;
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const { view, previous, next, actions } = latest.current;
      // Only the reading pages, never the plan calendar.
      const target =
        view === "read" &&
        pagingTarget(
          event,
          previous,
          next,
          () => !!document.querySelector("dialog[open]"),
        );
      if (!target) return;
      event.preventDefault();
      actions.go(target);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
}
