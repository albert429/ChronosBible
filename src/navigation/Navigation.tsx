import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Menu,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Settings,
  Share2,
} from "lucide-react";
import { catalog } from "../bible/catalog";
import { findBibleBook } from "../bible/navigation";
import {
  trackOf,
  type AnyReadingLocation,
  type BibleLocation,
  type ChronologicalLocation,
  type ReadingTrack,
} from "../bible/types";
import type { ChronologyCatalog } from "../chronology/types";
import { ar } from "../lib/format";
import type { Day } from "../plan/readings";
import type { TrackCompletion } from "../plan/progress";
import { shareApp } from "./share";
import { dayLabel, readingLabel } from "../plan/labels";
import { ChunkBoundary, Loading } from "../components/Feedback";
import Sheet from "../components/Sheet";
import { passageElement } from "../reader/scriptureDom";
import { TRACK_NAMES, TRACK_SHORT_NAMES } from "./modes";
import { connectionAllowsPrefetch } from "../lib/network";
import MenuPanel from "./MenuPanel";
import logo from "../assets/favicon.svg";
import "./Navigation.css";
const About = lazy(() => import("./About"));
// Sheet contents load apart from the reader: warmed when the page is idle,
// and by pressing or focusing their button, so opening one does not wait.
// The menu, every reader's way around, stays in the main bundle.
const loadChronologyPanel = () => import("./ChronologyPanel");
const ChronologyPanel = lazy(loadChronologyPanel);
const loadBiblePanel = () => import("./BiblePanel");
const BiblePanel = lazy(loadBiblePanel);
const loadDayPanel = () =>
  Promise.all([import("./DayPanel"), import("./DayJumper")]).then(
    ([panel]) => panel,
  );
const DayPanel = lazy(loadDayPanel);
const loadAppearancePanel = () => import("./AppearancePanel");
const AppearancePanel = lazy(loadAppearancePanel);
const warm = (load: () => Promise<unknown>) => () =>
  void load().catch(() => {});

export type View = "read" | "calendar";
const ADJACENT_LABELS = {
  bible: ["الإصحاح السابق", "الإصحاح التالي"],
  plan: ["اليوم السابق", "اليوم التالي"],
  chronological: ["القراءة السابقة", "القراءة التالية"],
} as const;
type Panel = "menu" | "day" | "appearance" | "about" | "bible" | "chronology";
type Props = {
  location: AnyReadingLocation;
  /** The neighbouring places in this mode (see `adjacentLocation`). */
  previous?: AnyReadingLocation;
  next?: AnyReadingLocation;
  go: (location: AnyReadingLocation) => void;
  chooseTrack: (track: ReadingTrack) => void;
  /** The open chronology's summaries (chronological mode only). */
  chronology?: ChronologyCatalog;
  chronologyError?: string;
  retryChronology: () => void;
  /** The current reading's title when the catalog is not loaded. */
  readingTitle: string;
  completion: TrackCompletion;
  continuous: boolean;
  setContinuous: (enabled: boolean) => void;
  view: View;
  navigate: (view: View) => void;
  menuToggle: RefObject<HTMLButtonElement | null>;
  readers: () => void;
  invite: (text: string) => void;
  notify: (notice: string) => void;
  selected: number;
  reading?: Day;
  readingError?: string;
  retryReading: () => void;
  goDay: (day: number) => void;
};
export default function Navigation({
  location,
  previous,
  next,
  go,
  chooseTrack,
  chronology,
  chronologyError,
  retryChronology,
  readingTitle,
  completion,
  continuous,
  setContinuous,
  view,
  navigate,
  menuToggle,
  readers,
  invite,
  notify,
  selected,
  reading,
  readingError,
  retryReading,
  goDay,
}: Props) {
  const track = trackOf(location);
  const bible = location.mode === "bible" ? location : undefined;
  const chrono = location.mode === "chronological" ? location : undefined;
  const place = bible
    ? `${findBibleBook(catalog, bible.book)!.name} ${ar(bible.chapter)}`
    : chrono
      ? readingTitle
      : dayLabel(selected);
  const [previousLabel, nextLabel] = ADJACENT_LABELS[location.mode];
  const pickerPanel: Panel = bible ? "bible" : chrono ? "chronology" : "day";
  const pickerLabel = bible
    ? `اختيار السفر والإصحاح: ${place}`
    : chrono
      ? `فهرس ${TRACK_NAMES[track]}: ${place || "جارٍ التحميل"}`
      : `تفاصيل ${place} · ${TRACK_NAMES.plan}`;
  const [panel, setPanel] = useState<Panel>("menu");
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const afterClose = useRef<(() => void) | null>(null);
  const [sheetTrigger, setSheetTrigger] = useState<HTMLElement | null>(null);
  function show(next: Panel, trigger: HTMLElement) {
    afterClose.current = null;
    setSheetTrigger(trigger);
    setPanel(next);
    setOpen(true);
  }
  function close(action?: () => void) {
    if (!open) return;
    afterClose.current = action || null;
    setOpen(false);
  }
  async function share() {
    if (sharing) return;
    setSharing(true);
    let fallback;
    try {
      fallback = await shareApp();
    } finally {
      setSharing(false);
    }
    if (fallback) close(() => invite(fallback));
  }
  function jump(index: number) {
    close(() => {
      const target = passageElement(index);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }
  // After the page settles, fetch the sheets this reader is likely to open.
  const picker = chrono
    ? loadChronologyPanel
    : bible
      ? loadBiblePanel
      : loadDayPanel;
  useEffect(() => {
    if (!connectionAllowsPrefetch()) return;
    const loads = [loadAppearancePanel, picker];
    const run = () => loads.forEach((load) => warm(load)());
    let idle = 0;
    const timer = setTimeout(() => {
      idle =
        typeof requestIdleCallback === "function"
          ? requestIdleCallback(run, { timeout: 3000 })
          : (run(), 0);
    }, 2000);
    return () => {
      clearTimeout(timer);
      if (idle) cancelIdleCallback(idle);
    };
  }, [picker]);
  const titles: Record<Panel, string> = {
    menu: "القائمة",
    bible: TRACK_NAMES.bible,
    day: readingLabel(selected),
    chronology: TRACK_NAMES[track],
    about: "عن التطبيق",
    appearance: "إعدادات القراءة",
  };
  return (
    <>
      <a className="skip-link" href="#main">
        انتقل إلى المحتوى
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <button
            ref={menuToggle}
            className="icon-button menu-toggle"
            aria-label="فتح القائمة"
            aria-haspopup="dialog"
            aria-expanded={open && panel === "menu"}
            onClick={(event) => show("menu", event.currentTarget)}
          >
            <img src={logo} width="28" height="28" alt="" />
            <Menu size={16} aria-hidden="true" />
          </button>
          {view === "read" ? (
            <>
              <button
                className="icon-button previous-day"
                disabled={!previous}
                onClick={() => previous && go(previous)}
                aria-label={previousLabel}
              >
                <ChevronRight size={20} aria-hidden="true" />
              </button>
              <h1 className="toolbar-day">
                <button
                  className="day-trigger"
                  aria-label={pickerLabel}
                  aria-haspopup="dialog"
                  aria-expanded={open && panel === pickerPanel}
                  data-track={track}
                  onPointerDown={warm(picker)}
                  onFocus={warm(picker)}
                  onClick={(event) => show(pickerPanel, event.currentTarget)}
                >
                  <span className="toolbar-place">
                    <small aria-hidden="true">{TRACK_SHORT_NAMES[track]}</small>
                    <span>{place || "…"}</span>
                  </span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </h1>
              <button
                className="icon-button next-day"
                disabled={!next}
                onClick={() => next && go(next)}
                aria-label={nextLabel}
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
            </>
          ) : (
            <div className="toolbar-title">{TRACK_NAMES.plan}</div>
          )}
          <button
            className="icon-button appearance-toggle"
            aria-label="إعدادات القراءة"
            aria-haspopup="dialog"
            aria-expanded={open && panel === "appearance"}
            onPointerDown={warm(loadAppearancePanel)}
            onFocus={warm(loadAppearancePanel)}
            onClick={(event) => show("appearance", event.currentTarget)}
          >
            <Settings size={20} aria-hidden="true" />
          </button>
        </div>
      </header>
      <Sheet
        open={open}
        returnFocusTo={sheetTrigger}
        title={titles[panel]}
        headerActions={
          panel === "menu" ? (
            <button
              type="button"
              className="icon-button"
              aria-label="مشاركة التطبيق"
              disabled={sharing}
              onClick={share}
            >
              <Share2 size={20} aria-hidden="true" />
            </button>
          ) : undefined
        }
        onClose={() => close()}
        onAfterClose={() => {
          const action = afterClose.current;
          afterClose.current = null;
          action?.();
        }}
      >
        <ChunkBoundary key={panel}>
          <Suspense fallback={<Loading label="جارٍ الفتح…" />}>
            {panel === "menu" ? (
              <MenuPanel
                track={view === "read" ? track : undefined}
                chooseTrack={chooseTrack}
                readers={readers}
                notify={notify}
                close={close}
                about={() => {
                  const trigger = sheetTrigger;
                  close(() => {
                    if (trigger) show("about", trigger);
                  });
                }}
              />
            ) : panel === "bible" && bible ? (
              <BiblePanel
                location={bible}
                go={go as (location: BibleLocation) => void}
                close={close}
              />
            ) : panel === "chronology" && chrono ? (
              <ChronologyPanel
                chronology={chronology}
                error={chronologyError}
                retry={retryChronology}
                location={chrono}
                completed={completion[track as `chrono:${"OT" | "NT"}`]}
                go={go as (location: ChronologicalLocation) => void}
                close={close}
              />
            ) : panel === "day" ? (
              <DayPanel
                selected={selected}
                reading={reading}
                readingError={readingError}
                retryReading={retryReading}
                go={goDay}
                navigate={navigate}
                close={close}
                jump={jump}
              />
            ) : panel === "appearance" ? (
              <AppearancePanel
                continuous={continuous}
                setContinuous={setContinuous}
              />
            ) : panel === "about" ? (
              <About />
            ) : null}
          </Suspense>
        </ChunkBoundary>
      </Sheet>
    </>
  );
}
