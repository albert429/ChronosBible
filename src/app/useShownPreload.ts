import { useEffect, useRef } from "react";
import type { ReadingLocation, ScriptureReading } from "../core/reading/types";
import { readingKey } from "../core/reading/identity";
import { afterStartup } from "../shared/browser/afterStartup";

/**
 * Once a reading's text is shown, the next launch fetches it alongside the
 * app (src/features/reader/preload.ts).
 */
export function useShownPreload(
  location: ReadingLocation,
  reading: ScriptureReading | undefined,
) {
  const shownKey = reading ? readingKey(reading) : "";
  const shown = useRef<[ReadingLocation, ScriptureReading?]>(null);
  useEffect(() => {
    if (!shownKey || shownKey !== readingKey(location)) return;
    shown.current = [location, reading];
    // Not needed until the next launch: its small module loads apart, after
    // the first screen, and records whatever is shown by then.
    afterStartup(
      () =>
        void import("../features/reader/preload").then(
          ({ readingPaths, rememberPreload }) => {
            if (shown.current) rememberPreload(readingPaths(...shown.current));
          },
          () => {},
        ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);
}
