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
import { dayIndex, pageFor, scheduledDay } from "../core/reading/schedule";
import { isReadingComplete } from "../features/profiles/domain/state";
import type { ReadingLocation } from "../core/reading/types";
import { readingKey, type ReadingTrack } from "../core/reading/identity";
import { adjacentLocation } from "../core/reading/adjacent";
import { readingTitle } from "../core/reading/labels";
import {
  chronologicalLocationExists,
  firstChronologicalLocation,
} from "../core/reading/chronologyCatalog";
import { days } from "../features/plan/data/client";
import { chapters } from "../features/bible/data/client";
import {
  chronologicalReadings,
  chronologyCatalogs,
} from "../features/chronology/data/client";
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
  const previous = adjacentLocation(location, -1, chronology.data);
  const next = adjacentLocation(location, 1, chronology.data);
  const title = readingTitle(location, chronology.data, reading.data);
  const goDay = (day: number) => go({ mode: "plan", day });
  return {
    progress,
    location,
    view,
    title,
    previous,
    next,
    alert: progress.error || modeError,
    dismissAlert() {
      progress.clearError();
      setModeError("");
    },
    /** The reading choices the navigation offers. */
    actions: {
      go,
      navigate,
      goDay,
      async chooseTrack(track: ReadingTrack) {
        const superseded = guard.begin();
        setModeError("");
        try {
          if (
            await chooseTrack(
              track,
              superseded,
              place.chooseMode,
              (testament) => chronologyCatalogs.load(testament),
            )
          )
            navigate("read");
        } catch (err) {
          setModeError((err as Error).message);
        }
      },
    },
    /** The reader's props, apart from completion (see `complete`). */
    reader: {
      location,
      navigation: place.navigation,
      restore: place.restore,
      previous,
      next,
      onPage: go,
      continuous: place.preferences.continuous,
      setContinuous: place.setContinuous,
      // Continuous listening moves on without taking keyboard focus.
      onContinue: place.go,
      reading: reading.data,
      chronology: chronology.data,
      error: reading.error,
      retry: reading.retry,
      done,
    },
    /** The plan calendar's props, apart from joining. */
    plan: {
      member,
      completed: completion.plan,
      start,
      currentDate,
      current: dayIndex(start, currentDate),
      page,
      setPage,
      go: goDay,
    },
    /** What the navigation sheets show. */
    sheets: {
      chronology: chronology.data,
      chronologyError: chronology.error,
      retryChronology: chronology.retry,
      completion,
      continuous: place.preferences.continuous,
      setContinuous: place.setContinuous,
      selected,
      reading: planReading.data,
      readingError: planReading.error,
      retryReading: planReading.retry,
    },
    /** Another reader, or none (null); false when it could not be saved. */
    chooseReader(id: string | null) {
      guard.supersede();
      if (!progress.select(id)) return false;
      setView("read");
      return true;
    },
    /**
     * Explicitly marks the reading done or not done; returns the notice.
     * Opening or listening never completes a reading.
     */
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
