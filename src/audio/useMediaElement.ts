import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { audioUrl } from "./url";
import type { Timeline } from "./manifest";
import {
  initialMediaState,
  isPlaying,
  isWaiting,
  mediaReducer,
} from "./mediaStatus.ts";
import { PlaylistController } from "./playlistController.ts";
import { saveRate, savedRate } from "./speed.ts";
import { audioBlocked } from "./usePauseOnDialog.ts";

const PLAY_ERROR = "تعذر تشغيل التسجيل. تحقق من الاتصال وحاول مرة أخرى.";
const STALL_ERROR = "تأخر تحميل التسجيل. تحقق من الاتصال وحاول مرة أخرى.";
const STALL_TIMEOUT = 20000;
/** Seconds of playback between saved resume positions while playing. */
const POSITION_INTERVAL = 5;

/**
 * Own the one <audio> element for the player's lifetime: playback state,
 * errors, seeking, playlist entries and teardown. Times are reading-timeline
 * seconds; `source` keys resume positions (src, or the playlist identity).
 */
export function useMediaElement(
  timeline: Timeline | undefined,
  options: {
    initialTime?: number | ((source: string) => number);
    onEnded?: () => void;
    /** Play the reading again from its start when it ends. */
    repeat?: boolean;
    onPosition?: (seconds: number, source: string) => void;
  } = {},
) {
  const audio = useRef<HTMLAudioElement>(null);
  const controller = useRef<PlaylistController>(null);
  controller.current ??= new PlaylistController((src) =>
    audioUrl(src, __AUDIO_BASE_URL__),
  );
  const token = useRef(0);
  const source = useRef<string | undefined>(undefined);
  const lastReported = useRef(-1);
  const callbacks = useRef(options);
  useLayoutEffect(() => {
    callbacks.current = options;
  });
  const report = useCallback(() => {
    const player = controller.current!;
    if (!source.current || !player.timeline) return;
    const seconds = player.time();
    lastReported.current = seconds;
    callbacks.current.onPosition?.(seconds, source.current);
  }, []);
  const [{ status, error }, dispatch] = useReducer(
    mediaReducer,
    initialMediaState,
  );
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(savedRate);
  // The browser refused to start without a direct tap (iOS, autoplay rules).
  const [blocked, setBlocked] = useState(false);
  const playing = isPlaying(status);
  const waiting = isWaiting(status);

  // Pausing a playing element fires "pause", which saves the position.
  const halt = useCallback((message?: string) => {
    token.current += 1;
    audio.current?.pause();
    dispatch({ type: "paused", message });
  }, []);
  const pause = useCallback(() => halt(), [halt]);

  const play = useCallback(async () => {
    const player = controller.current!;
    if (!audio.current || !player.timeline || audioBlocked()) return;
    const current = ++token.current;
    setBlocked(false);
    dispatch({ type: "request" });
    try {
      await player.play();
      if (current !== token.current) return;
      dispatch({ type: "started" });
    } catch (err) {
      if (current !== token.current) return;
      // iOS may require a second, direct tap after the manifest loads.
      setBlocked((err as Error).name === "NotAllowedError");
      dispatch({
        type: "paused",
        message:
          (err as Error).name !== "NotAllowedError" ? PLAY_ERROR : undefined,
      });
    }
  }, []);

  /** Seek on the reading timeline (verse skip, lock-screen scrubbing). */
  const seekTo = useCallback(
    (seconds: number) => {
      const player = controller.current!;
      if (!player.timeline) return;
      const wasPlaying = !!audio.current && !audio.current.paused;
      const entry = player.entry;
      player.seek(seconds);
      setTime(player.time());
      dispatch({ type: "seeked" });
      // A different file starts paused; keep listening across the switch.
      if (wasPlaying && player.entry !== entry) void play();
    },
    [play],
  );

  const clearError = useCallback(() => dispatch({ type: "clearError" }), []);

  // A new reading (or none): reset synchronously, restore its saved position
  // and start it. Continuations pass 0 through initialTime.
  useLayoutEffect(() => {
    const player = controller.current!;
    token.current += 1;
    lastReported.current = -1;
    source.current = timeline?.source;
    dispatch({ type: "paused" });
    player.attach(audio.current);
    const { initialTime } = callbacks.current;
    const seconds = timeline
      ? (typeof initialTime === "function"
          ? initialTime(timeline.source)
          : initialTime) || 0
      : 0;
    player.setTimeline(timeline, seconds);
    setTime(player.time());
  }, [timeline]);

  useEffect(() => {
    if (timeline) void play();
  }, [timeline, play]);

  useEffect(() => {
    const player = controller.current!;
    // A phone may discard a hidden page without another event.
    const hidden = () => {
      if (document.visibilityState === "hidden") report();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      report();
      token.current += 1;
      player.detach();
    };
  }, [report]);

  useEffect(() => {
    controller.current!.setRate(rate);
    saveRate(rate);
  }, [rate]);

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => halt(STALL_ERROR), STALL_TIMEOUT);
    return () => clearTimeout(timer);
  }, [waiting, halt]);

  const audioProps = {
    ref: audio,
    preload: "none" as const,
    onLoadedMetadata: () => {
      controller.current!.loadedMetadata();
      setTime(controller.current!.time());
    },
    onSeeking: () => controller.current!.seeking(),
    onPlaying: () => dispatch({ type: "playing" }),
    onPause: () => {
      const player = controller.current!;
      // The end of an inner entry pauses briefly before the next file plays.
      if (audio.current?.ended && !player.isLast()) return;
      report();
      dispatch({ type: "paused" });
    },
    onWaiting: () => {
      if (!audio.current?.paused) dispatch({ type: "waiting" });
    },
    onTimeUpdate: () => {
      const seconds = controller.current!.timeUpdate();
      setTime(seconds);
      if (Math.abs(seconds - lastReported.current) >= POSITION_INTERVAL)
        report();
    },
    onEnded: () => {
      const outcome = controller.current!.ended();
      if (outcome === "next") {
        setTime(controller.current!.time());
        // Same task as the native event, through the normal play path.
        void play();
        return;
      }
      if (outcome !== "finished") return;
      if (callbacks.current.repeat) {
        // From its start, in the same native event task as a continuation.
        void play();
        return;
      }
      dispatch({ type: "ended" });
      report();
      callbacks.current.onEnded?.();
    },
    onError: () => {
      if (!audio.current?.getAttribute("src")) return;
      report();
      halt(PLAY_ERROR);
    },
  };

  return {
    audio,
    audioProps,
    playing,
    waiting,
    ended: status === "ended",
    blocked,
    error,
    time,
    rate,
    setRate,
    play,
    pause,
    seekTo,
    clearError,
  };
}
