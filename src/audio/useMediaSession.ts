import { useEffect, useEffectEvent, useRef } from "react";
import { stepCueIndex, type Timeline } from "./manifest";
import appIcon from "../assets/favicon.svg";

type MediaSessionOptions = {
  timeline: Timeline | undefined;
  title: string;
  playing: boolean;
  time: number;
  rate: number;
  play: () => Promise<void>;
  pause: () => void;
  /** Seek on the reading timeline. */
  seekTo: (seconds: number) => void;
  onClose: () => void;
};

/** Lock-screen metadata, transport controls and position for the audio. */
export function useMediaSession({
  timeline,
  title,
  playing,
  time,
  rate,
  play,
  pause,
  seekTo,
  onClose,
}: MediaSessionOptions) {
  const stepCue = useEffectEvent((timeline: Timeline, step: number) => {
    const { cues } = timeline;
    if (!cues.length) return;
    const index = stepCueIndex(timeline, time, step);
    seekTo(cues[Math.max(0, Math.min(index, cues.length - 1))].start);
  });
  const scrub = useEffectEvent((timeline: Timeline, seconds: number) =>
    seekTo(Math.max(0, Math.min(seconds, timeline.duration))),
  );
  /** Lock-screen and headset skips: ten seconds unless the system says. */
  const skip = useEffectEvent((timeline: Timeline, seconds: number) =>
    scrub(timeline, time + seconds),
  );
  const resume = useEffectEvent(() => void play());
  const stop = useEffectEvent(() => {
    pause();
    onClose();
  });
  const halt = useEffectEvent(pause);
  // The system extrapolates the position from the rate, so it is reported on
  // play, pause, rate changes and seeks, not on every time update.
  const reported = useRef<{
    timeline: Timeline;
    playing: boolean;
    rate: number;
    position: number;
    at: number;
  }>(null);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !timeline) return;
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({
      title,
      artist: "ترجمة فان دايك · Faith Comes By Hearing",
      album: "الكتاب المقدس · ترجمة فان دايك",
      // Lock screens show PNGs (public/icons, the installed app's icons).
      artwork: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: appIcon, sizes: "any", type: "image/svg+xml" },
      ],
    });
    const handlers: Partial<
      Record<MediaSessionAction, MediaSessionActionHandler>
    > = {
      play: () => resume(),
      pause: () => halt(),
      previoustrack: () => stepCue(timeline, -1),
      nexttrack: () => stepCue(timeline, 1),
      seekbackward: (details) => skip(timeline, -(details.seekOffset || 10)),
      seekforward: (details) => skip(timeline, details.seekOffset || 10),
      seekto: (details) => {
        if (details.seekTime !== undefined) scrub(timeline, details.seekTime);
      },
      stop: () => stop(),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        session.setActionHandler(action as MediaSessionAction, handler);
      } catch {
        /* Browser support varies. */
      }
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        try {
          session.setActionHandler(action as MediaSessionAction, null);
        } catch {
          /* Unsupported action. */
        }
      }
      session.metadata = null;
      session.playbackState = "none";
      reported.current = null;
    };
  }, [timeline, title]);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !timeline) return;
    const at = performance.now();
    const last = reported.current;
    if (
      last &&
      last.timeline === timeline &&
      last.playing === playing &&
      last.rate === rate &&
      Math.abs(
        last.position + (playing ? ((at - last.at) / 1000) * rate : 0) - time,
      ) < 1.5
    )
      return;
    reported.current = { timeline, playing, rate, position: time, at };
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    try {
      navigator.mediaSession.setPositionState({
        duration: timeline.duration,
        playbackRate: rate,
        position: Math.min(time, timeline.duration),
      });
    } catch {
      /* Older browsers omit position-state support. */
    }
  }, [playing, time, rate, timeline]);
}
