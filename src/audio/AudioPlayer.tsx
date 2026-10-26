import {
  isBibleChapter,
  isChronologicalReading,
  type AnyReadingLocation,
  type AnyScriptureReading,
} from "../bible/types";
import { chapterVerse } from "../bible/reference";
import { dayLabel } from "../plan/labels";
import { ar } from "../lib/format";
import AudioControls from "./AudioControls";
import { nextEndAction, type EndAction } from "./endAction";
import {
  activeCueIndex,
  announcementAt,
  entryAt,
  stepCueIndex,
} from "./manifest";
import { nextRate } from "./speed.ts";
import { useAudioManifest } from "./useAudioManifest";
import { useMediaElement } from "./useMediaElement";
import { useMediaSession } from "./useMediaSession";
import { useNextManifest } from "./useNextManifest";
import { usePauseOnDialog } from "./usePauseOnDialog";
import { useVerseHighlight } from "./useVerseHighlight";

function readingTitle(reading: AnyScriptureReading) {
  if (isChronologicalReading(reading)) return reading.title;
  if (isBibleChapter(reading)) return `${reading.book} ${ar(reading.chapter)}`;
  return dayLabel(reading.day);
}

export default function AudioPlayer({
  reading,
  onClose,
  onEnded,
  initialTime = 0,
  onPosition,
  next,
  endAction,
  onEndAction,
  done,
  onComplete,
}: {
  reading: AnyScriptureReading;
  onClose: () => void;
  /** Only the parent may opt into an ended handoff; manual navigation unmounts. */
  onEnded?: () => void;
  initialTime?: number | ((source: string) => number);
  onPosition?: (seconds: number, source: string) => void;
  /** The continuation target, whose timing JSON may be fetched once playing. */
  next?: AnyReadingLocation;
  /** What happens when the recording ends (see endAction.ts). */
  endAction: EndAction;
  onEndAction: (action: EndAction) => void;
  /** Whether the reading is already marked done. */
  done: boolean;
  onComplete: () => void;
}) {
  const { timeline, error: loadError, retry } = useAudioManifest(reading);
  const media = useMediaElement(timeline, {
    initialTime,
    onEnded,
    onPosition,
    repeat: endAction === "repeat",
  });
  const { playing, waiting, time, rate, play, pause, seekTo } = media;
  useNextManifest(next, playing);
  const index = timeline ? activeCueIndex(timeline, time) : -1;
  const cue = timeline?.cues[index];
  const announcement = timeline && announcementAt(timeline, time);
  // A playlist entry is its reading passage; one file may hold several.
  const entryIndex = timeline ? entryAt(timeline, time) : 0;
  const entry = timeline?.entries[entryIndex];
  const passage =
    reading.passages[
      announcement?.passage ??
        cue?.passage ??
        ((timeline?.entries.length ?? 0) > 1 ? entryIndex : 0)
    ];
  // A recording's own opening is labelled by the chapter reference below; only
  // inserted spoken references have reviewed display text.
  const detail =
    announcement?.kind === "reference"
      ? announcement.reference
      : entry?.alignment === "chapter"
        ? "تسجيل الإصحاح دون تتبع الآيات"
        : undefined;
  const label = readingTitle(reading);
  const step = (direction: number) => {
    if (!timeline?.cues.length) return;
    const target = stepCueIndex(timeline, time, direction);
    seekTo(
      timeline.cues[Math.max(0, Math.min(target, timeline.cues.length - 1))]
        .start,
    );
  };

  usePauseOnDialog(pause);
  const { detached, follow, resume } = useVerseHighlight(cue, playing);
  useMediaSession({
    timeline,
    title: label,
    playing,
    time,
    rate,
    play,
    pause,
    seekTo,
    onClose,
  });

  return (
    <AudioControls
      label={media.ended ? "انتهى التسجيل" : label}
      detail={detail}
      reference={
        passage && {
          book: passage.book,
          location: cue
            ? chapterVerse(passage.chapter, cue.verse)
            : ar(passage.chapter),
        }
      }
      ready={!!timeline}
      cueIndex={index}
      cueCount={timeline?.cues.length ?? 0}
      canPrevious={!!timeline && stepCueIndex(timeline, time, -1) >= 0}
      active={playing || waiting}
      rate={rate}
      time={time}
      duration={timeline?.duration ?? 0}
      error={media.error || loadError || ""}
      waiting={waiting}
      blocked={media.blocked}
      endAction={endAction}
      offerComplete={media.ended && endAction === "stop" && !done}
      detached={detached}
      onFollow={follow}
      onPrevious={() => step(-1)}
      onToggle={() => (playing || waiting ? pause() : void play())}
      onNext={() => step(1)}
      onSeek={seekTo}
      onRate={() => media.setRate(nextRate(rate))}
      onEndAction={() => onEndAction(nextEndAction(endAction))}
      onComplete={onComplete}
      onRetry={() => {
        if (timeline) void play();
        else {
          media.clearError();
          retry();
        }
      }}
      onClose={onClose}
    >
      <audio
        {...media.audioProps}
        onSeeking={() => {
          media.audioProps.onSeeking();
          // A jump (slider, verse skip, lock screen) follows the text again.
          resume();
        }}
      />
    </AudioControls>
  );
}
