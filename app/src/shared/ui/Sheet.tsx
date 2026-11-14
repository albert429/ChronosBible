import {
  useEffectEvent,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { useModalDialog } from "./useModalDialog";
import "./Sheet.css";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  onAfterClose?: () => void;
  returnFocusTo?: HTMLElement | null;
  headerActions?: ReactNode;
  /** Listening continues while this sheet is open (see usePauseOnDialog). */
  keepsAudio?: boolean;
  children: ReactNode;
};

/** Keep the native dialog mounted; retain its content only through its exit. */
export default function Sheet({
  open,
  title,
  onClose,
  onAfterClose,
  returnFocusTo,
  children,
  headerActions,
  keepsAudio,
}: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [closing, setClosing] = useState(false);
  const [retained, setRetained] = useState(false);
  const { dialog, requestClose, finishClose, dialogProps } = useModalDialog({
    open,
    onClose,
    onAfterClose: () => {
      setClosing(false);
      setRetained(false);
      onAfterClose?.();
    },
    returnFocusTo,
    cancel: "defer",
    syncNativeClose: true,
    exit: (finish) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        finish();
      else setClosing(true);
    },
  });
  const finishExit = useEffectEvent(() => {
    if (!open) finishClose();
  });

  useLayoutEffect(() => {
    if (open) {
      setRetained(true);
      setClosing(false);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!closing || open || !surface.current) return;

    // Read the committed exit animation, so the fallback follows the CSS.
    const style = getComputedStyle(surface.current);
    const names = style.animationName.split(",").map((name) => name.trim());
    const durations = style.animationDuration.split(",");
    const delays = style.animationDelay.split(",");
    const milliseconds = (value: string) =>
      parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000);
    const index = names.indexOf("sheet-exit");
    const duration =
      index < 0
        ? 0
        : milliseconds(durations[index % durations.length]) +
          milliseconds(delays[index % delays.length]);
    if (duration <= 0) {
      finishExit();
      return;
    }
    const timer = setTimeout(finishExit, duration);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleMotionChange = () => {
      if (reducedMotion.matches) finishExit();
    };
    reducedMotion.addEventListener("change", handleMotionChange);
    return () => {
      clearTimeout(timer);
      reducedMotion.removeEventListener("change", handleMotionChange);
    };
  }, [closing, open]);

  return (
    <dialog
      ref={dialog}
      className="reader-sheet"
      aria-labelledby={titleId}
      data-closing={closing ? "true" : undefined}
      data-keeps-audio={keepsAudio || undefined}
      {...dialogProps}
    >
      <div
        ref={surface}
        className="sheet-surface"
        onAnimationEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.animationName === "sheet-exit" &&
            closing &&
            !open
          ) {
            finishClose();
          }
        }}
      >
        {(open || retained) && (
          <>
            <div className="sheet-header">
              <h2 id={titleId}>{title}</h2>
              <div className="sheet-header-actions">
                {headerActions}
                <button
                  type="button"
                  className="icon-button"
                  aria-label="إغلاق النافذة"
                  onClick={requestClose}
                  autoFocus
                >
                  <X size={22} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="sheet-body">{children}</div>
          </>
        )}
      </div>
    </dialog>
  );
}
