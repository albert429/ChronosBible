import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useProgress } from "../features/profiles/useProgress";
import { useReadingLocation } from "../features/reader/useReadingLocation";
import type { View } from "../features/navigation/model";
import { dayIndex, pageFor, scheduledDay } from "../domain/reading/schedule";
import { isReadingComplete } from "../domain/profiles/state";
import type { ReadingLocation } from "../domain/reading/types";
import { readingKey, type ReadingTrack } from "../domain/reading/identity";
import { adjacentLocation } from "../domain/reading/adjacent";
import { readingTitle } from "../domain/reading/labels";
import {
  chronologicalLocationExists,
  firstChronologicalLocation,
} from "../domain/reading/chronologyCatalog";
import { days } from "../data/plan/client";
import { chapters } from "../data/bible/client";
import {
  chronologicalReadings,
  chronologyCatalogs,
} from "../data/chronology/client";
import { useResource } from "../shared/hooks/useResource";
import { useToday } from "../shared/hooks/useToday";
import { today } from "../shared/lib/format";
import {
  chooseTrack,
  createChoiceGuard,
  type SessionMarks,
} from "./trackChoice";

/**
 * The reading session: the active reader's place in every track, the
 * resources it shows, the reading/calendar view, and the choices that change
 * them. Completion is only ever explicit (`complete`). `main` is focused
 * after the view changes.
 */
export function useReadingSession(main: RefObject<HTMLElement | null>) {
  const progress = useProgress();
  const { member, completion } = progress;
  const place = useReadingLocation(
    member?.id ?? "",
    member ? scheduledDay(member.startDate, today()) : 1,
  );
  const location = place.location;
  const selected = place.plan.day;
  const [page, setPage] = useState(() => pageFor(selected));
  const [seenSwitches, setSeenSwitches] = useState(progress.switches);
  const [view, setView] = useState<View>("read");
  const [seenNavigation, setSeenNavigation] = useState(place.navigation);
  if (seenNavigation !== place.navigation) {
    setSeenNavigation(place.navigation);
    setView("read");
  }
  const [modeError, setModeError] = useState("");
  const currentDate = useToday();
  // The latest choice wins; see createChoiceGuard.
  const marks = useRef<SessionMarks>({
    navigation: place.navigation,
    switches: progress.switches,
  });
  useLayoutEffect(() => {
    marks.current = {
      navigation: place.navigation,
      switches: progress.switches,
    };
  });
  const [guard] = useState(() => createChoiceGuard(() => marks.current));
  const start = member?.startDate || currentDate;
  const chronological = location.mode === "chronological";
  const planReading = useResource(
    days,
    String(selected),
    location.mode === "plan",
  );
  const chapterReading = useResource(
    chapters,
    readingKey(location),
    location.mode === "bible",
  );
  const chronoReading = useResource(
    chronologicalReadings,
    readingKey(location),
    chronological,
  );
  // Summaries only: titles, stages and order. Text loads per reading.
  const chronology = useResource(
    chronologyCatalogs,
    chronological ? location.testament : "",
    chronological,
  );
  const reading =
    location.mode === "plan"
      ? planReading
      : location.mode === "bible"
        ? chapterReading
        : chronoReading;
  const done = isReadingComplete({ completion }, location);

  // A remembered or linked reading the current catalog no longer has: start
  // that chronology from its first reading instead of a dead end.
  const stale =
    chronological &&
    !!chronology.data &&
    !chronologicalLocationExists(chronology.data, location);
  useEffect(() => {
    if (stale && chronology.data)
      place.go(firstChronologicalLocation(chronology.data), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, chronology.data]);

  if (seenSwitches !== progress.switches) {
    // Another reader: their own last places, or their scheduled day.
    const day = place.selectReader(
      member?.id ?? "",
      member ? scheduledDay(member.startDate, today()) : 1,
    );
    setSeenSwitches(progress.switches);
    setPage(pageFor(day));
  }

  function navigate(next: View) {
    setView(next);
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }));
    window.scrollTo({ top: 0 });
  }
  function go(next: ReadingLocation) {
    guard.supersede();
    setModeError("");
    place.go(next);
    navigate("read");
  }
  return {
    progress,
    member,
    completion,
    location,
    navigation: place.navigation,
    /** Whether the reader resumes its remembered position. */
    restore: place.restore,
    continuous: place.preferences.continuous,
    setContinuous: place.setContinuous,
    /** Continuous listening moves on without taking keyboard focus. */
    onContinue: place.go,
    selected,
    page,
    setPage,
    view,
    start,
    currentDate,
    current: dayIndex(start, currentDate),
    reading,
    planReading,
    chronology,
    previous: adjacentLocation(location, -1, chronology.data),
    next: adjacentLocation(location, 1, chronology.data),
    title: readingTitle(location, chronology.data, reading.data),
    done,
    alert: progress.error || modeError,
    dismissAlert() {
      progress.clearError();
      setModeError("");
    },
    navigate,
    go,
    async chooseTrack(track: ReadingTrack) {
      const superseded = guard.begin();
      setModeError("");
      await chooseTrack(track, superseded, {
        open: place.chooseMode,
        loadCatalog: (testament) => chronologyCatalogs.load(testament),
        opened: () => navigate("read"),
        failed: setModeError,
      });
    },
    /** Another reader, or none (null); false when it could not be saved. */
    chooseReader(id: string | null) {
      guard.supersede();
      if (!progress.select(id)) return false;
      setView("read");
      return true;
    },
    /** Explicit only; opening or listening never completes a reading. */
    complete() {
      return progress.completeReading(member?.id ?? "", location, !done)
        ? done
          ? "تم التراجع عن إتمام القراءة"
          : location.mode === "plan"
            ? "تم حفظ قراءتك. خطوة جديدة في الرحلة!"
            : "تم حفظ قراءتك."
        : undefined;
    },
  };
}
export type ReadingSession = ReturnType<typeof useReadingSession>;
