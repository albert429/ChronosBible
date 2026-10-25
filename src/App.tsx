import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, X } from "lucide-react";
import { useProgress } from "./plan/useProgress";
import { dayIndex, pageFor, scheduledDay } from "./plan/schedule";
import { isReadingComplete } from "./plan/progress";
import Reader, { readingTitle } from "./reader/Reader";
import Navigation, { type View } from "./navigation/Navigation";
import PlanView from "./plan/PlanView";
import { ChunkBoundary, Loading } from "./components/Feedback";
import type { Modal } from "./plan/dialogs";
import { useResource } from "./lib/useResource";
import { useToday } from "./lib/useToday";
import { useNotice } from "./lib/useNotice";
import { useModalDialog } from "./components/useModalDialog";
import { chapters } from "./bible/client";
import {
  readingKey,
  type AnyReadingLocation,
  type ReadingTrack,
} from "./bible/types";
import {
  chronologicalLocationExists,
  chronologicalReadings,
  chronologyCatalogs,
  firstChronologicalLocation,
} from "./chronology/client";
import { useReadingLocation } from "./reader/useReadingLocation";
import { days } from "./plan/readings";
import { adjacentLocation } from "./navigation/adjacent";
import { TRACK_NAMES } from "./navigation/modes";
const Dialogs = lazy(() => import("./plan/dialogs"));
const DIALOG_NAMES: Record<Modal["kind"], string> = {
  join: "القراء على هذا الجهاز",
  settings: "إعدادات القارئ",
  invite: "مشاركة التطبيق",
};

export default function App() {
  const progress = useProgress();
  const { member, error, completion } = progress;
  const locationState = useReadingLocation(
    member?.id ?? "",
    member ? scheduledDay(member.startDate) : 1,
    { chronological: true },
  );
  const location = locationState.location;
  const selected = locationState.plan.day;
  const [page, setPage] = useState(() => pageFor(selected));
  const [seenSwitches, setSeenSwitches] = useState(progress.switches);
  const [view, setView] = useState<View>("read");
  const [seenNavigation, setSeenNavigation] = useState(
    locationState.navigation,
  );
  if (seenNavigation !== locationState.navigation) {
    setSeenNavigation(locationState.navigation);
    setView("read");
  }
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useNotice();
  const [modeError, setModeError] = useState("");
  const currentDate = useToday();
  const menuToggle = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  // The latest mode choice; an older asynchronous choice must not apply.
  const intent = useRef(0);
  const latest = useRef({
    navigation: locationState.navigation,
    switches: progress.switches,
  });
  useLayoutEffect(() => {
    latest.current = {
      navigation: locationState.navigation,
      switches: progress.switches,
    };
  });
  const start = member?.startDate || currentDate;
  const current = dayIndex(start, currentDate);
  const done = isReadingComplete({ completion }, location);
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
  const previous = adjacentLocation(location, -1, chronology.data);
  const next = adjacentLocation(location, 1, chronology.data);
  const title = readingTitle(location, chronology.data, reading.data);
  useEffect(() => {
    const page = view === "read" ? title : TRACK_NAMES.plan;
    document.title = page ? `${page} · الكتاب المقدس` : "الكتاب المقدس";
  }, [title, view]);
  // Arrow keys page like the toolbar's chevrons (next is on the left).
  const paging = useRef({ view, previous, next, go });
  useLayoutEffect(() => {
    paging.current = { view, previous, next, go };
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const { view, previous, next, go } = paging.current;
      const target =
        event.key === "ArrowLeft"
          ? next
          : event.key === "ArrowRight"
            ? previous
            : undefined;
      if (
        !target ||
        view !== "read" ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.target as Element | null)?.closest?.(
          "input, select, textarea, [contenteditable]",
        ) ||
        document.querySelector("dialog[open]")
      )
        return;
      event.preventDefault();
      go(target);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);

  // A remembered or linked reading the current catalog no longer has: start
  // that chronology from its first reading instead of a dead end.
  const stale =
    chronological &&
    !!chronology.data &&
    !chronologicalLocationExists(chronology.data, location);
  useEffect(() => {
    if (stale && chronology.data)
      locationState.go(firstChronologicalLocation(chronology.data), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, chronology.data]);

  if (seenSwitches !== progress.switches) {
    // Another reader: their own last places, or their scheduled day.
    const day = locationState.selectReader(
      member?.id ?? "",
      member ? scheduledDay(member.startDate) : 1,
    );
    setSeenSwitches(progress.switches);
    setPage(pageFor(day));
  }
  function navigate(next: View) {
    setView(next);
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }));
    window.scrollTo({ top: 0 });
  }
  function go(next: AnyReadingLocation) {
    intent.current++;
    setModeError("");
    locationState.go(next);
    navigate("read");
  }
  async function chooseTrack(track: ReadingTrack) {
    const request = ++intent.current;
    const before = latest.current;
    setModeError("");
    if (locationState.chooseMode(track)) {
      navigate("read");
      return;
    }
    // A chronology opens on its first reading the first time; its catalog
    // may still be loading. Any later choice, navigation (including Back)
    // or reader change wins over this one when it resolves.
    const superseded = () =>
      request !== intent.current ||
      latest.current.navigation !== before.navigation ||
      latest.current.switches !== before.switches;
    const testament = track === "chrono:OT" ? "OT" : "NT";
    try {
      const catalog = await chronologyCatalogs.load(testament);
      if (superseded()) return;
      if (locationState.chooseMode(track, firstChronologicalLocation(catalog)))
        navigate("read");
    } catch (err) {
      if (!superseded()) setModeError((err as Error).message);
    }
  }
  function openModal(next: Modal) {
    progress.clearError();
    setModal(next);
  }
  function closeModal() {
    setModal(null);
  }
  function chooseReader(id: string | null) {
    intent.current++;
    if (!progress.select(id)) return;
    if (id === null) setModal({ kind: "join" });
    else closeModal();
    setView("read");
  }
  function complete() {
    // Explicit only, for a named reader or the guest; opening or listening
    // never completes a reading.
    if (progress.completeReading(member?.id ?? "", location, !done))
      setNotice(
        done
          ? "تم التراجع عن إتمام القراءة"
          : location.mode === "plan"
            ? "تم حفظ قراءتك. خطوة جديدة في الرحلة!"
            : "تم حفظ قراءتك.",
      );
  }
  const { dialog, dialogProps } = useModalDialog({
    open: modal !== null,
    onClose: closeModal,
    cancel: "native",
    syncNativeClose: false,
    fallbackFocus: menuToggle,
  });
  const alert = error || modeError;
  return (
    <div className="app">
      <Navigation
        location={location}
        previous={previous}
        next={next}
        go={go}
        chooseTrack={chooseTrack}
        chronology={chronology.data}
        chronologyError={chronology.error}
        retryChronology={chronology.retry}
        readingTitle={title}
        completion={completion}
        continuous={locationState.preferences.continuous}
        setContinuous={locationState.setContinuous}
        view={view}
        navigate={navigate}
        readers={() => openModal({ kind: member ? "settings" : "join" })}
        invite={(text) => openModal({ kind: "invite", text })}
        notify={setNotice}
        menuToggle={menuToggle}
        selected={selected}
        reading={planReading.data}
        readingError={planReading.error}
        retryReading={planReading.retry}
        goDay={(day) => go({ mode: "plan", day })}
      />
      <main
        id="main"
        ref={main}
        tabIndex={-1}
        className={view === "read" ? "reading-main" : undefined}
      >
        {alert && !modal && (
          <div className="error" role="alert">
            <span>{alert}</span>
            <button
              className="icon-button"
              onClick={() => {
                progress.clearError();
                setModeError("");
              }}
              aria-label="إغلاق التنبيه"
            >
              <X size={18} />
            </button>
          </div>
        )}
        {view === "read" ? (
          <Reader
            key={member?.id || "guest"}
            location={location}
            navigation={locationState.navigation}
            restore={locationState.restore}
            previous={previous}
            next={next}
            onPage={go}
            continuous={locationState.preferences.continuous}
            // Continuous listening moves on without taking keyboard focus.
            onContinue={locationState.go}
            reading={reading.data}
            chronology={chronology.data}
            error={reading.error}
            retry={reading.retry}
            done={done}
            complete={complete}
          />
        ) : (
          <PlanView
            member={member}
            completed={completion.plan}
            start={start}
            currentDate={currentDate}
            current={current}
            page={page}
            setPage={setPage}
            go={(day) => go({ mode: "plan", day })}
            join={() => openModal({ kind: "join" })}
          />
        )}
      </main>
      <dialog
        className="app-dialog"
        aria-label={DIALOG_NAMES[modal?.kind ?? "join"]}
        ref={dialog}
        {...dialogProps}
      >
        <div className="dialog-content">
          <button
            className="icon-button dialog-close"
            aria-label="إغلاق"
            onClick={closeModal}
          >
            <X size={22} />
          </button>
          {modal && (
            <ChunkBoundary key={modal.kind}>
              <Suspense fallback={<Loading label="جارٍ فتح النافذة…" />}>
                <Dialogs
                  modal={modal}
                  close={closeModal}
                  navigate={navigate}
                  setNotice={setNotice}
                  chooseReader={chooseReader}
                />
              </Suspense>
            </ChunkBoundary>
          )}
        </div>
        {notice && modal && (
          <div className="dialog-notice" role="status">
            <Check size={19} />
            <span>{notice}</span>
          </div>
        )}
      </dialog>
      {notice && !modal && (
        <div className="toast" role="status">
          <Check size={19} />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}
