import { useState, lazy, Suspense } from "react";
import { readingHasAudio } from "../audio/availability";
import {
  type ReadingLocation,
  type ScriptureReading,
} from "../../core/reading/types";
import { readingKey } from "../../core/reading/identity";
import type { ChronologyCatalog } from "../../core/reading/chronology";
import { readingTitle } from "../../core/reading/labels";
import { Loading, LoadError, ChunkBoundary } from "../../shared/ui/Feedback";
import { loadVerseStudy } from "../study/load";
import CompletionBar from "./CompletionBar";
import Scripture from "./Scripture";
import { useAdjacentPrefetch } from "./useAdjacentPrefetch";
import { useVerseTap } from "./useVerseTap";
import { useSwipePaging } from "./useSwipePaging";
import { usePositionRestore } from "./usePositionRestore";
import { useListeningSession } from "./useListeningSession";
import { studyContext } from "./studyContext";
import "./Reader.css";
const AudioPlayer = lazy(() => import("../audio/AudioPlayer"));
const VerseStudy = lazy(loadVerseStudy);

type Props = {
  location: ReadingLocation;
  navigation: number;
  /** Resume the reader's remembered position in this reading. */
  restore: boolean;
  /** The neighbouring places in this mode, for swipes and the next button. */
  previous?: ReadingLocation;
  next?: ReadingLocation;
  onPage: (location: ReadingLocation) => void;
  reading?: ScriptureReading;
  /** The open chronology's summaries, for labels and continuous listening. */
  chronology?: ChronologyCatalog;
  error?: string;
  retry: () => void;
  done: boolean;
  complete: () => void;
  continuous: boolean;
  setContinuous: (enabled: boolean) => void;
  onContinue: (location: ReadingLocation) => void;
};

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
  useAdjacentPrefetch(location, current, error, chronology);
  const listen = useListeningSession({
    current,
    identity,
    navigation,
    onContinue,
  });
  const tap = useVerseTap(current);
  const swipe = useSwipePaging((direction) => {
    const target = direction === 1 ? next : previous;
    if (target) onPage(target);
  });
  // Reset against requested navigation, even while the new text is still cold.
  // Only native ended creates a listening intent for the next navigation.
  const seen = `${navigation} ${identity}`;
  const [seenPlace, setSeenPlace] = useState(seen);
  if (seenPlace !== seen) {
    setSeenPlace(seen);
    listen.navigated();
    tap.reset();
  }
  usePositionRestore(current, identity, location.verse, navigation, restore);
  const audio = readingHasAudio(location);
  // Where «متابعة» may continue: the next place in this mode whose recording
  // is published. The player decides whether to (its «عند الانتهاء»).
  const listenNext = next && readingHasAudio(next) ? next : undefined;
  const label = readingTitle(location, chronology, current);
  const study =
    tap.target &&
    current &&
    studyContext(current, tap.target.passage, tap.target.verse);
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
            listening={!!listen.listening}
            onToggleListen={listen.toggle}
            listenButton={listen.listenButton}
          />
        ) : (
          <Loading />
        )}
      </article>
      {listen.reading && (
        <div className="audio-launch">
          <ChunkBoundary>
            <Suspense fallback={<Loading label="جارٍ فتح المشغل…" />}>
              <AudioPlayer
                reading={listen.reading}
                next={listenNext}
                continuous={continuous}
                setContinuous={setContinuous}
                done={done}
                onComplete={complete}
                {...listen.player}
              />
            </Suspense>
          </ChunkBoundary>
        </div>
      )}
      {tap.target && study && (
        <ChunkBoundary>
          <Suspense fallback={null}>
            <VerseStudy
              open={tap.open}
              context={study}
              returnFocusTo={tap.target.el}
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
