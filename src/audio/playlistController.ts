import { entryAt, type Timeline } from "./manifest.ts";

/** The parts of HTMLAudioElement the playlist drives (a fake in unit tests). */
export type MediaLike = {
  src: string;
  currentTime: number;
  playbackRate: number;
  defaultPlaybackRate: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly error: unknown;
  readonly readyState: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
};

/**
 * One persistent media element plays a reading's timeline. Each entry is a
 * separate immutable file; the element's own `ended` event switches to the
 * next file and plays it in the same task, so locked phones keep going and no
 * timer ever clips a recording. Every new file bumps `generation`.
 */
export class PlaylistController {
  element: MediaLike | null = null;
  timeline: Timeline | undefined;
  entry = 0;
  generation = 0;
  rate = 1;
  /** Local seconds to apply once the current file's metadata is known. */
  private pending: number | undefined;
  /** The last known timeline position, kept across errors for retry. */
  private known = 0;
  /** Set once the final entry ended naturally; replay or seek re-arms it. */
  private finished = false;
  private loaded: string | undefined;
  private resolve: (src: string) => string;

  constructor(resolve: (src: string) => string = (src) => src) {
    this.resolve = resolve;
  }

  attach(element: MediaLike | null) {
    this.element = element;
  }

  /** Start a reading (or nothing) at a timeline position; never plays by itself. */
  setTimeline(timeline: Timeline | undefined, seconds = 0) {
    this.timeline = timeline;
    this.finished = false;
    this.element?.pause();
    if (!timeline) {
      this.generation += 1;
      this.loaded = undefined;
      this.pending = undefined;
      this.known = 0;
      if (this.element) {
        this.element.removeAttribute("src");
        this.element.load();
      }
      return;
    }
    this.load(seconds);
  }

  /** Timeline seconds, including a seek that has not been applied yet. */
  time() {
    // A failed file may report 0; keep the last known place for retry.
    if (!this.timeline || !this.element || this.element.error)
      return this.known;
    const entry = this.timeline.entries[this.entry];
    const local = this.pending ?? this.element.currentTime;
    return Math.min(this.timeline.duration, entry.offset + (local || 0));
  }

  private clamp(seconds: number) {
    const duration = this.timeline?.duration ?? 0;
    return Math.max(0, Math.min(seconds || 0, Math.max(0, duration - 0.05)));
  }

  /** Point the element at the entry holding `seconds` (switching files if needed). */
  private load(seconds: number) {
    const element = this.element;
    const timeline = this.timeline;
    if (!element || !timeline) return;
    const target = this.clamp(seconds);
    const index = entryAt(timeline, target);
    const entry = timeline.entries[index];
    const local = target - entry.offset;
    this.entry = index;
    this.known = target;
    if (this.loaded === entry.src && !element.error) {
      // Same file: seek in place (before metadata, keep it pending).
      if (element.readyState >= 1) {
        this.pending = undefined;
        element.currentTime = local;
      } else this.pending = local;
      return;
    }
    this.generation += 1;
    this.loaded = entry.src;
    this.pending = local > 0 ? local : undefined;
    element.src = this.resolve(entry.src);
    // Loading resets playbackRate to defaultPlaybackRate.
    element.defaultPlaybackRate = this.rate;
    element.playbackRate = this.rate;
  }

  /** Apply a seek requested before the file's metadata arrived. */
  loadedMetadata() {
    const element = this.element;
    if (!element || this.pending === undefined) return;
    const local = this.pending;
    this.pending = undefined;
    element.currentTime = local;
  }

  /** Remember the position while playing, for retry and reporting. */
  timeUpdate() {
    if (this.element && !this.element.error && this.pending === undefined)
      this.known = this.time();
    return this.time();
  }

  seek(seconds: number) {
    this.finished = false;
    this.load(seconds);
  }

  setRate(rate: number) {
    this.rate = rate;
    if (this.element) {
      this.element.defaultPlaybackRate = rate;
      this.element.playbackRate = rate;
    }
  }

  /**
   * Resume playback. After a network or decode error the current file is
   * loaded again at the last known position; after the final entry ended,
   * the reading starts again from the beginning.
   */
  play() {
    const element = this.element;
    if (!element || !this.timeline) return Promise.resolve();
    if (element.error) {
      this.loaded = undefined;
      this.load(this.known);
    } else if (this.finished || (element.ended && this.isLast())) {
      // Load the first file afresh rather than seek an ended one back to
      // its start: WebKit can then stall, playing yet never advancing.
      this.finished = false;
      this.loaded = undefined;
      this.load(0);
    }
    return element.play();
  }

  isLast() {
    return !!this.timeline && this.entry >= this.timeline.entries.length - 1;
  }

  /**
   * The element's native `ended`. Returns "next" after switching to the
   * following entry (the caller must play it, once), "finished" exactly once after the last
   * entry, or "ignored" for a stale or repeated event: once the next file is
   * loading the element is no longer `ended`.
   */
  ended(): "next" | "finished" | "ignored" {
    const element = this.element;
    if (!element || !this.timeline || !element.ended) return "ignored";
    if (!this.isLast()) {
      const next = this.timeline.entries[this.entry + 1];
      this.load(next.offset);
      // The caller plays it from the same native event task (no new user
      // gesture needed) through its normal play path, so a rejection shows
      // retry with the position kept.
      return "next";
    }
    this.known = this.timeline.duration;
    if (this.finished) return "ignored";
    this.finished = true;
    return "finished";
  }

  /** A seek away from the end re-arms the final ended callback. */
  seeking() {
    if (this.element && !this.element.ended) this.finished = false;
  }

  detach() {
    const element = this.element;
    this.generation += 1;
    this.timeline = undefined;
    this.loaded = undefined;
    if (element) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.element = null;
  }
}
