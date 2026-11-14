import { useRef, useState } from "react";
import type { Panel } from "./model";

/**
 * The navigation sheet: which panel is open, the button that opened it
 * (focus returns there), and actions deferred until it has closed. The
 * sheet calls `closed` after its dialog closes and focus returns to the
 * trigger, so a deferred navigation, dialog or passage jump moves focus
 * last; opening a sheet drops an action an earlier close left pending.
 */
export function useSheetController() {
  const [panel, setPanel] = useState<Panel>("menu");
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const pending = useRef<(() => void) | null>(null);
  return {
    panel,
    open,
    trigger,
    /** Whether `which` is the open panel, for its button's aria-expanded. */
    expanded: (which: Panel) => open && panel === which,
    show(next: Panel, from: HTMLElement) {
      pending.current = null;
      setTrigger(from);
      setPanel(next);
      setOpen(true);
    },
    /** Closes the sheet; `action` runs once it has closed and returned focus. */
    close(action?: () => void) {
      if (!open) return;
      pending.current = action || null;
      setOpen(false);
    },
    closed() {
      const action = pending.current;
      pending.current = null;
      action?.();
    },
  };
}
export type SheetController = ReturnType<typeof useSheetController>;
