import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";

type Options = {
  /** Whether the dialog should be shown modally. */
  open: boolean;
  /** The user asked to close; the owner turns `open` off. */
  onClose: () => void;
  onAfterClose?: () => void;
  /** Focus returns here, instead of to whatever was focused on opening. */
  returnFocusTo?: HTMLElement | null;
  /**
   * Escape: "defer" keeps the dialog open until the owner's close completes
   * (sheets close after their exit); "native" lets the browser close it first.
   */
  cancel: "defer" | "native";
  /**
   * Whether a native close the owner did not request (a dialog-method form,
   * `close()`) also asks the owner to close.
   */
  syncNativeClose: boolean;
  /**
   * Without it, a connected trigger regains focus, without scrolling. With it,
   * focus returns only when this hook closed the dialog, to a trigger that is
   * connected and not inside a closed dialog, otherwise to this element.
   */
  fallbackFocus?: RefObject<HTMLElement | null>;
  /**
   * Called when `open` turns off, instead of closing at once; the owner calls
   * `finish` when its exit is done.
   */
  exit?: (finish: () => void) => void;
};

/** Keep a native `<dialog>` in step with `open`, and focus with its trigger. */
export function useModalDialog({
  open,
  onClose,
  onAfterClose,
  returnFocusTo,
  cancel,
  syncNativeClose,
  fallbackFocus,
  exit,
}: Options) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const active = useRef(false);
  const closeRequested = useRef(false);
  const expectedCloseEvents = useRef(0);

  function restoreFocus(closedHere: boolean) {
    const target = trigger.current;
    if (!fallbackFocus) {
      if (target?.isConnected) target.focus({ preventScroll: true });
    } else if (closedHere) {
      if (target?.isConnected && !target.closest("dialog:not([open])"))
        target.focus();
      else fallbackFocus.current?.focus();
    }
  }

  function finishClose() {
    if (!active.current) return;
    active.current = false;
    const element = dialog.current;
    const closedHere = element?.open === true;
    if (element && closedHere) {
      // Native close events are asynchronous; consume ours even if reopened.
      expectedCloseEvents.current += 1;
      element.close();
    }
    restoreFocus(closedHere);
    trigger.current = null;
    onAfterClose?.();
  }

  function requestClose() {
    if (open && !closeRequested.current) {
      closeRequested.current = true;
      onClose();
    }
  }

  const sync = useEffectEvent(() => {
    const element = dialog.current;
    if (!element) return;

    if (open) {
      closeRequested.current = false;
      if (!active.current) {
        trigger.current =
          returnFocusTo ||
          (document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null);
        active.current = true;
      }
      if (!element.open) element.showModal();
    } else if (active.current) {
      if (exit) exit(finishClose);
      else finishClose();
    }
  });
  useLayoutEffect(() => {
    sync();
  }, [open]);

  return {
    dialog,
    requestClose,
    finishClose,
    dialogProps: {
      onCancel(event: SyntheticEvent<HTMLDialogElement>) {
        if (cancel === "defer") event.preventDefault();
        requestClose();
      },
      onClose() {
        if (expectedCloseEvents.current > 0) {
          expectedCloseEvents.current -= 1;
          return;
        }
        // A native close (for example, a dialog-method form) must also update
        // the controlling state, without handling a stale event after reopen.
        if (!syncNativeClose || dialog.current?.open || !active.current) return;
        requestClose();
        finishClose();
      },
      onClick(event: MouseEvent<HTMLDialogElement>) {
        if (event.target === event.currentTarget) requestClose();
      },
    },
  };
}
