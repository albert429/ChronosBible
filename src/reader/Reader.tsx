import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { readingHasAudio } from "../audio/availability";
import { catalog } from "../bible/catalog";
import { findBibleBook } from "../bible/navigation";
import {
  isChronologicalReading,
  readingKey,
  type AnyReadingLocation,
  type AnyScriptureReading,
  type BibleChapter,
  type ScriptureReading,
} from "../bible/types";
import type { ChronologyCatalog } from "../chronology/types";
import { ar } from "../lib/format";
import { readingLabel } from "../plan/labels";
import { Loading, LoadError, ChunkBoundary } from "../components/Feedback";
import { loadVerseStudy, type StudyTarget } from "../study/load";
import CompletionBar from "./CompletionBar";
import Scripture from "./Scripture";
import {
  useAdjacentPrefetch,
  useChapterPrefetch,
  useChronologyPrefetch,
} from "./useAdjacentPrefetch";
import { useVerseTap } from "./useVerseTap";
import { useSwipePaging } from "./useSwipePaging";
import {
  clearSelected,
  markSelected,
  scrollToVerse,
  verseElement,
  verseNumberButton,
} from "./scriptureDom";
import {
  playbackPosition,
  readingPosition,
  savePlaybackPosition,
} from "./location";
import "./Reader.css";
const AudioPlayer = lazy(() => import("../audio/AudioPlayer"));
const VerseStudy = lazy(loadVerseStudy);

type Props = {
  location: AnyReadingLocation;
  navigation: number;
  /** Resume the reader's remembered position in this reading. */
  restore: boolean;
  /** The neighbouring places in this mode, for swipes and the next button. */
  previous?: AnyReadingLocation;
  next?: AnyReadingLocation;
  onPage: (location: AnyReadingLocation) => void;
  reading?: AnyScriptureReading;
  /** The open chronology's summaries, for labels and continuous listening. */
  chronology?: ChronologyCatalog;
  error?: string;
  retry: () => void;
  done: boolean;
  complete: () => void;
  continuous: boolean;
  setContinuous: (enabled: boolean) => void;
  onContinue: (location: AnyReadingLocation) => void;
};
type Listening = {
  continuing?: boolean;
  identity: string;
  navigation: number;
  reading: AnyScriptureReading;
};

/**
 * Verse study works per canonical chapter: a chronological passage is
 * studied as its own chapter's verses.
 */
function studyView(
  reading: AnyScriptureReading,
  target: StudyTarget,
): { reading: ScriptureReading; target: StudyTarget } | undefined {
  if (!isChronologicalReading(reading)) return { reading, target };
  const passage = reading.passages[target.passage];
  const book = passage && catalog.find((item) => item.name === passage.book);
  if (!book) return;
  const chapter: BibleChapter = {
    mode: "bible",
    usfm: book.usfm,
    book: book.name,
    chapter: passage.chapter,
    verseCount: passage.verses.length,
    passages: [passage],
    structure: [],
  };
  return { reading: chapter, target: { ...target, passage: 0 } };
}

export function readingTitle(
  location: AnyReadingLocation,
  chronology?: ChronologyCatalog,
  reading?: AnyScriptureReading,
) {
  if (location.mode === "plan") return readingLabel(location.day);
  if (location.mode === "bible")
    return `${findBibleBook(catalog, location.book)!.name} ${ar(location.chapter)}`;
  return (
    chronology?.readings.find((item) => item.id === location.readingId)
      ?.title ??
    (reading && isChronologicalReading(reading) ? reading.title : "")
  );
}

const DONE_LABELS = {
  plan: "تمت قراءة هذا اليوم",
  bible: "تمت قراءة هذا الإصحاح",
  chronological: "تمت هذه القراءة",
};

export default function Reader({
  location,
  navigation,
  restore,
  previous,
  next,
  onPage,
  reading,
  chronology,
  error,
  retry,
  done,
  complete,
  continuous,
  setContinuous,
  onContinue,
}: Props) {
  const identity = readingKey(location);
  // Never render a previous reading under the new place's controls.
  const current =
    reading && readingKey(reading) === identity ? reading : undefined;
  const plan = location.mode === "plan";
  useAdjacentPrefetch(
    plan ? location.day : 0,
    current && "day" in current ? current : undefined,
    error,
    plan,
  );
  useChapterPrefetch(location, current, error);
  useChronologyPrefetch(location, current, error, chronology);
  const [listening, setListening] = useState<Listening | null>(null);
  const playerSource = useRef<string | null>(null);
  const listenButton = useRef<HTMLButtonElement>(null);
  const toggleListen = useCallback(() => {
    setListening((active) =>
      active || !current ? null : { identity, navigation, reading: current },
    );
  }, [current, identity, navigation]);
  const tap = useVerseTap(current);
  const swipe = useSwipePaging((direction) => {
    const target = direction === 1 ? next : previous;
    if (target) onPage(target);
  });
  const [seenNavigation, setSeenNavigation] = useState(navigation);
  const [seenIdentity, setSeenIdentity] = useState(identity);
  // Reset against requested navigation, even while the new text is still cold.
  // Only native ended creates a listening intent for the next navigation.
  if (seenNavigation !== navigation || seenIdentity !== identity) {
    setSeenNavigation(navigation);
    setSeenIdentity(identity);
    if (listening?.navigation !== navigation || listening.identity !== identity)
      setListening(null);
    tap.reset();
  }
  useLayoutEffect(() => {
    let target: HTMLElement | null;
    let offset: number | undefined;
    let clear: (() => void) | undefined;
    if (!location.verse) {
      const saved = restore && current && readingPosition(identity);
      target = saved ? verseElement(saved.passage, saved.verse) : null;
      offset = saved ? saved.offset : undefined;
      if (!target) {
        window.scrollTo({ top: 0, behavior: "instant" });
        return;
      }
      scrollToVerse(target, offset);
    } else {
      if (!current) return;
      // A chronological link names a verse number but not its occurrence: the
      // first passage that contains it (canonical links have one passage).
      const verse = location.verse;
      const passage = Math.max(
        0,
        current.passages.findIndex(
          (item) => verse >= item.start && verse <= item.end,
        ),
      );
      target = verseElement(passage, verse);
      if (!target) return;
      verseNumberButton(target)?.focus({ preventScroll: true });
      scrollToVerse(target);
      // The linked verse stays marked until the reader next touches the page.
      const marked = target;
      markSelected(marked);
      clear = () => clearSelected(marked);
      document.addEventListener("pointerdown", clear, { once: true });
    }
    // The text can arrive before its fonts (it is fetched with the page), and
    // their swap moves it: place it again once they settle, unless the reader
    // has scrolled since.
    const placed = target;
    const at = window.scrollY;
    let active = true;
    if (document.fonts?.status === "loading")
      void document.fonts.ready.then(() => {
        if (active && Math.abs(window.scrollY - at) < 2)
          scrollToVerse(placed, offset);
      });
    return () => {
      active = false;
      if (clear) {
        document.removeEventListener("pointerdown", clear);
        clear();
      }
    };
  }, [current, identity, location.verse, navigation, restore]);
  const audio = readingHasAudio(location);
  // Where «متابعة» may continue: the next place in this mode whose recording
  // is published. The player decides whether to (its «عند الانتهاء»).
  const listenNext = next && readingHasAudio(next) ? next : undefined;
  const playerReading = listening && (current || listening.reading);
  function ended(next?: AnyReadingLocation) {
    if (playerSource.current) savePlaybackPosition(playerSource.current, 0);
    if (!playerReading) return;
    if (!next) return;
    setListening({
      continuing: true,
      identity: readingKey(next),
      navigation: navigation + 1,
      reading: playerReading,
    });
    onContinue(next);
  }
  const label = readingTitle(location, chronology, current);
  const study = tap.target && current && studyView(current, tap.target);
  return (
    <div className="reading-layout">
      <article
        className="reader"
        aria-label={label || undefined}
        data-day={plan ? location.day : undefined}
        data-reading={identity}
        aria-busy={!current && !error}
        onPointerDown={tap.onPointerDown}
        onClick={tap.onClick}
        {...swipe}
      >
        {error ? (
          <LoadError message={error} retry={retry} />
        ) : current ? (
          <Scripture
            reading={current}
            audio={audio}
            listening={!!listening}
            onToggleListen={toggleListen}
            listenButton={listenButton}
          />
        ) : (
          <Loading />
        )}
      </article>
      {listening && playerReading && (
        <div className="audio-launch">
          <ChunkBoundary>
            <Suspense fallback={<Loading label="جارٍ فتح المشغل…" />}>
              <AudioPlayer
                reading={playerReading}
                next={listenNext}
                continuous={continuous}
                setContinuous={setContinuous}
                done={done}
                onComplete={complete}
                initialTime={(source) =>
                  listening.continuing ? 0 : playbackPosition(source)
                }
                onPosition={(seconds, source) => {
                  playerSource.current = source;
                  savePlaybackPosition(source, seconds);
                }}
                onEnded={ended}
                onClose={() => {
                  const trigger = listenButton.current;
                  setListening(null);
                  requestAnimationFrame(() => {
                    if (trigger?.isConnected)
                      trigger.focus({ preventScroll: true });
                  });
                }}
              />
            </Suspense>
          </ChunkBoundary>
        </div>
      )}
      {study && (
        <ChunkBoundary>
          <Suspense fallback={null}>
            <VerseStudy
              open={tap.open}
              reading={study.reading}
              target={study.target}
              onClose={tap.close}
              onAfterClose={tap.afterClose}
            />
          </Suspense>
        </ChunkBoundary>
      )}
      {current && (
        <CompletionBar
          key={identity}
          plan={location.mode === "plan"}
          done={done}
          doneLabel={DONE_LABELS[location.mode]}
          onComplete={complete}
          nextLabel={next && readingTitle(next, chronology)}
          onNext={next && (() => onPage(next))}
        />
      )}
    </div>
  );
}
