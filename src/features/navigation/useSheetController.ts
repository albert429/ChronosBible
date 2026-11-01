import { useState } from "react";
import type { Panel } from "./model";
import { createAfterClose } from "./sheetController";

/**
 * The navigation sheet: which panel is open, the button that opened it
 * (focus returns there), and actions deferred until it has closed.
 */
export function useSheetController() {
  const [panel, setPanel] = useState<Panel>("menu");
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [afterClose] = useState(createAfterClose);
  return {
    panel,
    open,
    trigger,
    /** Whether `which` is the open panel, for its button's aria-expanded. */
    expanded: (which: Panel) => open && panel === which,
    show(next: Panel, from: HTMLElement) {
      afterClose.opened();
      setTrigger(from);
      setPanel(next);
      setOpen(true);
    },
    /** Closes the sheet; `action` runs once it has closed and returned focus. */
    close(action?: () => void) {
      if (!open) return;
      afterClose.closing(action);
      setOpen(false);
    },
    closed: afterClose.closed,
  };
}
export type SheetController = ReturnType<typeof useSheetController>;
