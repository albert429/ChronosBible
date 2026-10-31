import { useSyncExternalStore } from "react";

/**
 * What the player does when a recording ends: stop, play the same reading
 * again, or continue to the next day, chapter or chronological reading.
 * "next" is the long-standing `continuous` preference (kept with progress);
 * repeating is this device's own choice.
 */
export type EndAction = "stop" | "repeat" | "next";

const REPEAT_KEY = "bible-reader-audio-repeat-v1";
const listeners = new Set<() => void>();
let repeat: boolean | undefined;

function get() {
  if (repeat === undefined)
    try {
      repeat = localStorage.getItem(REPEAT_KEY) === "true";
    } catch {
      repeat = false;
    }
  return repeat;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
function setRepeat(value: boolean) {
  repeat = value;
  try {
    if (value) localStorage.setItem(REPEAT_KEY, "true");
    else localStorage.removeItem(REPEAT_KEY);
  } catch {
    /* This session only. */
  }
  listeners.forEach((listener) => listener());
}

export const endAction = (repeat: boolean, continuous: boolean): EndAction =>
  repeat ? "repeat" : continuous ? "next" : "stop";

/** The choice after `action` in the player's cycle. */
export const nextEndAction = (action: EndAction): EndAction =>
  action === "stop" ? "next" : action === "next" ? "repeat" : "stop";

export const END_ACTION_LABELS: Record<EndAction, string> = {
  stop: "عند الانتهاء: إيقاف",
  next: "عند الانتهاء: متابعة إلى التالي",
  repeat: "عند الانتهاء: إعادة القراءة",
};

/**
 * The current end action and a setter that keeps `continuous` in step, so
 * the reading settings' checkbox and the player always agree.
 */
export function useEndAction(
  continuous: boolean,
  setContinuous: (enabled: boolean) => void,
) {
  const repeating = useSyncExternalStore(subscribe, get, () => false);
  return [
    endAction(repeating, continuous),
    (action: EndAction) => {
      setRepeat(action === "repeat");
      if (continuous !== (action === "next")) setContinuous(action === "next");
    },
  ] as const;
}
