import type { ChronologyCatalog } from "../domain/reading/chronology.ts";
import { firstChronologicalLocation } from "../domain/reading/chronologyCatalog.ts";
import type { ReadingTrack } from "../domain/reading/identity.ts";
import type { ChronologicalLocation } from "../domain/reading/types.ts";
import type { Testament } from "../domain/scripture/types.ts";

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

type TrackChoice = {
  /** Opens the track at its last place, or at `start`; false without one. */
  open: (track: ReadingTrack, start?: ChronologicalLocation) => boolean;
  loadCatalog: (testament: Testament) => Promise<ChronologyCatalog>;
  /** The track opened. */
  opened: () => void;
  failed: (message: string) => void;
};

/**
 * Opens a track where the reader left it. A chronology opens on its first
 * reading the first time, once its catalog loads, unless the choice has
 * been superseded by then; a failure is reported only while it is current.
 */
export async function chooseTrack(
  track: ReadingTrack,
  superseded: () => boolean,
  { open, loadCatalog, opened, failed }: TrackChoice,
) {
  if (open(track)) {
    opened();
    return;
  }
  try {
    const catalog = await loadCatalog(track === "chrono:OT" ? "OT" : "NT");
    if (superseded()) return;
    if (open(track, firstChronologicalLocation(catalog))) opened();
  } catch (err) {
    if (!superseded()) failed((err as Error).message);
  }
}
