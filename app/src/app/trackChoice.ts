import type { ChronologyCatalog } from "../core/reading/chronology.ts";
import { firstChronologicalLocation } from "../core/reading/chronologyCatalog.ts";
import type { ReadingTrack } from "../core/reading/identity.ts";
import type { ChronologicalLocation } from "../core/reading/types.ts";
import type { Testament } from "../core/scripture/types.ts";

/** What a pending choice must still match when it resolves. */
export type SessionMarks = {
  /** Counts every navigation, including Back/Forward. */
  navigation: number;
  /** Counts every change of the active reader. */
  switches: number;
};

/**
 * Orders reading choices. Only the latest choice may apply: an asynchronous
 * one (a chronology whose catalog is still loading) is superseded by any
 * later choice, navigation (including Back) or reader change.
 */
export function createChoiceGuard(marks: () => SessionMarks) {
  let intent = 0;
  return {
    /** A choice applied at once: any pending one is dropped. */
    supersede() {
      intent++;
    },
    /** Starts a choice; the result reports whether it has been superseded. */
    begin() {
      const request = ++intent;
      const before = marks();
      return () => {
        const now = marks();
        return (
          request !== intent ||
          now.navigation !== before.navigation ||
          now.switches !== before.switches
        );
      };
    },
  };
}

/**
 * Opens a track where the reader left it, with `open` (false without a
 * place, or `start`). A chronology opens on its first reading the first
 * time, once its catalog loads, unless the choice has been superseded by
 * then. Resolves whether the track opened; a failure rejects only while the
 * choice is current.
 */
export async function chooseTrack(
  track: ReadingTrack,
  superseded: () => boolean,
  open: (track: ReadingTrack, start?: ChronologicalLocation) => boolean,
  loadCatalog: (testament: Testament) => Promise<ChronologyCatalog>,
): Promise<boolean> {
  if (open(track)) return true;
  try {
    const catalog = await loadCatalog(track === "chrono:OT" ? "OT" : "NT");
    return !superseded() && open(track, firstChronologicalLocation(catalog));
  } catch (err) {
    if (superseded()) return false;
    throw err;
  }
}
