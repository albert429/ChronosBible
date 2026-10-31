import { useEffect } from "react";

/**
 * A modal dialog that covers the reading pauses listening. The reading
 * settings and verse study sheets are marked `data-keeps-audio`: they sit
 * over the text being read, so playback continues under them.
 */
export const audioBlocked = () =>
  !!document.querySelector("dialog[open]:not([data-keeps-audio])");

/** Pause as soon as such a dialog is open, and whenever one opens later. */
export function usePauseOnDialog(pause: () => void) {
  useEffect(() => {
    const checkDialogs = () => {
      if (audioBlocked()) pause();
    };
    const observer = new MutationObserver(checkDialogs);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    checkDialogs();
    return () => observer.disconnect();
  }, [pause]);
}
