import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { catalog } from "../bible/catalog";
import {
  parseAnyReadingLocation,
  parseReadingLocation,
} from "../bible/navigation";
import {
  readingKey,
  type AnyReadingLocation,
  type ChronologicalLocation,
  type PlanLocation,
  type ReadingLocation,
  type ReadingTrack,
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
  saveReadingPosition,
  trackPlace,
  validAnyLocation,
  withPlace,
  type ReaderPlaces,
} from "./location";
import { topVisibleVerse } from "./scriptureDom";

// The reader restores its own places (see `restore` below).
if (typeof history !== "undefined") history.scrollRestoration = "manual";

/** Saves the top visible verse of the place on screen, before leaving it. */
function remember(place: AnyReadingLocation) {
  const identity = readingKey(place);
  const position = topVisibleVerse(identity);
  if (position !== null) saveReadingPosition(identity, position);
}

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
  // Opening the app, Back/Forward and returning to a mode resume where the
  // reader was; moving on to another place starts at its top.
  const [restore, setRestore] = useState(true);
  const shown = useRef(here);
  useLayoutEffect(() => {
    shown.current = here;
  });
  useEffect(() => {
    const leave = () => remember(shown.current);
    const hide = () => {
      if (document.visibilityState === "hidden") leave();
    };
    addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    return () => {
      removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
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
        remember(shown.current);
        setRestore(true);
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
  /**
   * Opens a place. Choosing the reading already open is still a manual
   * selection (it restarts that reading), but adds no history entry.
   */
  function go(next: AnyReadingLocation, replace = false, resume = false) {
    if (!allowed(next)) return;
    if (next.verse === undefined && readingKey(next) === readingKey(here))
      replace = true;
    remember(here);
    setRestore(resume);
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
    /** Whether the reader should resume its remembered position. */
    restore,
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
      go(next, false, true);
      return true;
    },
    /** Switch to another reader's places; returns their plan day. */
    selectReader(nextReader: string, nextScheduled: number) {
      remember(here);
      setRestore(true);
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
