import type { ReactNode } from "react";
import {
  ChevronDown,
  CircleStop,
  ListEnd,
  Pause,
  Play,
  Repeat1,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { ar, clock } from "../lib/format";
import { END_ACTION_LABELS, type EndAction } from "./endAction";
import "./audio.css";

const END_ACTION_ICONS = {
  stop: CircleStop,
  next: ListEnd,
  repeat: Repeat1,
};

type AudioControlsProps = {
  /** The audio element, rendered inside the player section. */
  children: ReactNode;
  label: string;
  reference?: { book: string; location: string };
  /** Shown instead of the verse reference: a spoken passage reference or a timing note. */
  detail?: string;
  /** False until the manifest has loaded. */
  ready: boolean;
  cueIndex: number;
  cueCount: number;
  canPrevious?: boolean;
  active: boolean;
  rate: number;
  time: number;
  duration: number;
  error: string;
  waiting: boolean;
  /** The browser wants a direct tap on play before it starts. */
  blocked: boolean;
  endAction: EndAction;
  /** Offer to mark the reading done (it ended and is not done yet). */
  offerComplete: boolean;
  /** The reader scrolled away from the verse being read. */
  detached: boolean;
  onFollow: () => void;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onRate: () => void;
  onEndAction: () => void;
  onComplete: () => void;
  onRetry: () => void;
  onClose: () => void;
};

export default function AudioControls({
  children,
  label,
  reference,
  detail,
  ready,
  cueIndex,
  cueCount,
  canPrevious,
  active,
  rate,
  time,
  duration,
  error,
  waiting,
  blocked,
  endAction,
  offerComplete,
  detached,
  onFollow,
  onPrevious,
  onToggle,
  onNext,
  onSeek,
  onRate,
  onEndAction,
  onComplete,
  onRetry,
  onClose,
}: AudioControlsProps) {
  const EndIcon = END_ACTION_ICONS[endAction];
  const position = Math.min(time, duration);
  return (
    <section className="audio-player" aria-label="مشغل القراءة الصوتية">
      {children}
      {detached && (
        <button className="audio-follow" onClick={onFollow}>
          <ChevronDown size={16} aria-hidden="true" />
          العودة إلى الآية الحالية
        </button>
      )}
      <div className="audio-player-inner">
        <div className="audio-current">
          <span>{label}</span>
          {detail ? (
            <span className="audio-reference">{detail}</span>
          ) : (
            reference && (
              <span className="audio-reference">
                {reference.book} <bdi dir="ltr">{reference.location}</bdi>
              </span>
            )
          )}
        </div>
        {/* The skip icons are mirrored on purpose: the player reads right to left. */}
        <button
          className="icon-button"
          aria-label="الآية السابقة"
          disabled={!ready || cueCount === 0 || !(canPrevious ?? cueIndex > 0)}
          onClick={onPrevious}
        >
          <SkipForward size={18} aria-hidden="true" />
        </button>
        {/* Stays focusable while the next recording loads, as in continuous
            listening; a disabled button would drop keyboard focus. */}
        <button
          className="icon-button audio-play"
          aria-label={active ? "إيقاف مؤقت" : "تشغيل التسجيل"}
          aria-disabled={!ready}
          onClick={ready ? onToggle : undefined}
        >
          {active ? (
            <Pause size={21} aria-hidden="true" />
          ) : (
            <Play size={21} aria-hidden="true" />
          )}
        </button>
        <button
          className="icon-button"
          aria-label="الآية التالية"
          disabled={!ready || cueCount === 0 || cueIndex === cueCount - 1}
          onClick={onNext}
        >
          <SkipBack size={18} aria-hidden="true" />
        </button>
        {!error && (
          <button
            className="icon-button audio-close"
            aria-label="إغلاق المشغل"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="audio-timeline">
        <span className="audio-time" aria-hidden="true">
          {clock(position)}
        </span>
        <input
          type="range"
          className="audio-seek"
          aria-label="موضع التسجيل"
          aria-valuetext={`${clock(position)} من ${clock(duration)}`}
          min={0}
          max={duration || 1}
          step={1}
          value={position}
          disabled={!ready || !duration}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <span className="audio-time" aria-hidden="true">
          {clock(duration)}
        </span>
        <button
          className="icon-button audio-speed"
          aria-label={`سرعة القراءة: ${ar(rate)}×`}
          title="تغيير سرعة القراءة"
          dir="ltr"
          onClick={onRate}
        >
          {ar(rate)}×
        </button>
        <button
          className="icon-button audio-end"
          aria-label={END_ACTION_LABELS[endAction]}
          title={END_ACTION_LABELS[endAction]}
          data-action={endAction}
          onClick={onEndAction}
        >
          <EndIcon size={18} aria-hidden="true" />
        </button>
      </div>
      {error || !ready || waiting ? (
        <div className="audio-status" role={error ? "alert" : "status"}>
          <span>{error || "جارٍ تحميل التسجيل…"}</span>
          {error && (
            <button className="text-button" onClick={onRetry}>
              حاول مرة أخرى
            </button>
          )}
          {error && (
            <button className="text-button" onClick={onClose}>
              إغلاق
            </button>
          )}
        </div>
      ) : blocked && !active ? (
        <div className="audio-status" role="status">
          <span>اضغط زر التشغيل لبدء الاستماع.</span>
        </div>
      ) : (
        offerComplete && (
          // Completion stays the reader's own choice: offered, never assumed.
          <div className="audio-status audio-offer">
            <span>هل أتممت هذه القراءة؟</span>
            <button className="text-button" onClick={onComplete}>
              نعم، تمت
            </button>
          </div>
        )
      )}
    </section>
  );
}
