import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReadingLocation } from "../domain/reading/types";
import type { View } from "../features/navigation/model";
import { pagingTarget } from "./keyboardPaging";

/** Arrow keys page the reading (see `pagingTarget`). */
export function useKeyboardPaging(paging: {
  view: View;
  previous?: ReadingLocation;
  next?: ReadingLocation;
  go: (location: ReadingLocation) => void;
}) {
  const latest = useRef(paging);
  useLayoutEffect(() => {
    latest.current = paging;
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const { view, previous, next, go } = latest.current;
      const target = pagingTarget(event, {
        reading: view === "read",
        previous,
        next,
        dialogOpen: () => !!document.querySelector("dialog[open]"),
      });
      if (!target) return;
      event.preventDefault();
      go(target);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);
}
