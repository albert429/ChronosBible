import { useEffect, useMemo, useState } from "react";
import { catalog } from "../bible/catalog";
import {
  parseAnyReadingLocation,
  parseReadingLocation,
} from "../bible/navigation";
import type {
  AnyReadingLocation,
  ChronologicalLocation,
  PlanLocation,
  ReadingLocation,
  ReadingTrack,
} from "../bible/types";
import { loadProgress, readerPlaces, saveReaderPlaces } from "../plan/progress";
import {
  currentPlace,
  freshPlaces,
  LOCATION_KEY,
  loadPreferences,
  locationSearch,
  placesFromPreferences,
  sameLocation,
  trackPlace,
  validAnyLocation,
  withPlace,
  type ReaderPlaces,
} from "./location";

function savedPlaces(reader: string) {
  try {
    const state = loadProgress(localStorage);
    return {
      places: readerPlaces(state, reader),
      continuous: state.continuous,
    };
  } catch {
    // Unreadable progress: still resume from the v1 places, without writing.
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LOCATION_KEY);
    } catch {
      /* session only */
    }
    const preferences = loadPreferences(raw);
    return {
      places: raw ? placesFromPreferences(preferences, reader) : freshPlaces(),
      continuous: preferences.continuous,
    };
  }
}

/**
 * The reading choice and each track's last place for the active reader
 * (`reader` is their id, "" for a guest), with history entries and links.
 * `scheduled` is their youth plan day, used until they have a plan place.
 * Places are saved per reader and track; opening a place never completes it.
 *
 * Until the UI renders chronology, `chronological` stays false: chronology
 * links are ignored and `location` equals `current`. With it on, `location`
 * may be chronological while `current` keeps the plan/Bible view.
 */
export function useReadingLocation(
  reader: string,
  scheduled: number,
  { chronological = false }: { chronological?: boolean } = {},
) {
  const parse = (search: string): AnyReadingLocation | undefined =>
    chronological
      ? parseAnyReadingLocation(search, catalog)
      : parseReadingLocation(search, catalog);
  const allowed = (next: unknown): next is AnyReadingLocation =>
    validAnyLocation(next) && (chronological || next.mode !== "chronological");
  const [state, setState] = useState(() => {
    const saved = savedPlaces(reader);
    // An explicit link wins over the remembered place.
    const linked = parse(location.search);
    return {
      reader,
      scheduled,
      continuous: saved.continuous,
      places: linked ? withPlace(saved.places, linked) : saved.places,
    };
  });
  const { places } = state;
  const plan = useMemo(
    () => trackPlace(places, "plan", state.scheduled) as PlanLocation,
    [places, state.scheduled],
  );
  const here = useMemo(
    () => currentPlace(places, state.scheduled, chronological),
    [places, state.scheduled, chronological],
  );
  const current: ReadingLocation =
    here.mode === "chronological"
      ? (trackPlace(places, "bible", state.scheduled) as ReadingLocation)
      : here;
  const [navigation, setNavigation] = useState(0);
  useEffect(() => {
    // An address that already names this place, such as an explicit ?day=
    // link, is kept so that a reload returns to it.
    const search = sameLocation(parse(location.search), here)
      ? location.search
      : locationSearch(here);
    history.replaceState(
      { ...history.state, scripture: here },
      "",
      `${location.pathname}${search}${location.hash}`,
    );
    try {
      saveReaderPlaces(localStorage, state.reader, places, state.continuous);
    } catch {
      /* session only */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, here, state.reader, state.continuous]);
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      const next = allowed(event.state?.scripture)
        ? (event.state.scripture as AnyReadingLocation)
        : parse(location.search);
      if (next) {
        setState((saved) => ({
          ...saved,
          places: withPlace(saved.places, next),
        }));
        setNavigation((n) => n + 1);
      }
    };
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chronological]);
  function go(next: AnyReadingLocation, replace = false) {
    if (!allowed(next)) return;
    const url = `${location.pathname}${locationSearch(next)}${location.hash}`;
    history[replace ? "replaceState" : "pushState"](
      { ...history.state, scripture: next },
      "",
      url,
    );
    setState((saved) => ({ ...saved, places: withPlace(saved.places, next) }));
    setNavigation((n) => n + 1);
  }
  return {
    /** The plan or Bible place the current reader UI renders. */
    current,
    /** The true current place, chronological when enabled. */
    location: here,
    track: places.track,
    places: places as ReaderPlaces,
    navigation,
    plan,
    preferences: { continuous: state.continuous },
    go,
    /**
     * Open a track at its last place. A chronology not yet opened needs
     * `start` (its catalog's first reading); returns false without one.
     */
    chooseMode(track: ReadingTrack, start?: ChronologicalLocation): boolean {
      const next = trackPlace(places, track, state.scheduled) ?? start;
      if (!next || !allowed(next)) return false;
      go(next);
      return true;
    },
    /** Switch to another reader's places; returns their plan day. */
    selectReader(nextReader: string, nextScheduled: number) {
      const next = savedPlaces(nextReader).places;
      setState((saved) => ({
        ...saved,
        reader: nextReader,
        scheduled: nextScheduled,
        places: next,
      }));
      return (trackPlace(next, "plan", nextScheduled) as PlanLocation).day;
    },
    setContinuous: (continuous: boolean) =>
      setState((saved) => ({ ...saved, continuous })),
  };
}
