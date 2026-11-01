import { useEffect, type RefObject } from "react";
import type { ReadingLocation } from "../../domain/reading/types";
import { connectionAllowsPrefetch } from "../../shared/browser/network";
import { navigationModel, type View } from "./model";
import { useSheetController } from "./useSheetController";
import {
  loadAppearancePanel,
  loadBiblePanel,
  loadChronologyPanel,
  loadDayPanel,
  warm,
} from "./panels";
import Toolbar from "./Toolbar";
import SheetHost, { type SheetActions, type SheetData } from "./SheetHost";

type Props = {
  location: ReadingLocation;
  /** The neighbouring places in this mode (see `adjacentLocation`). */
  previous?: ReadingLocation;
  next?: ReadingLocation;
  /** The current reading's title when the catalog is not loaded. */
  readingTitle: string;
  view: View;
  menuToggle: RefObject<HTMLButtonElement | null>;
  actions: SheetActions;
  data: SheetData;
};

/** The toolbar and its sheet, sharing one sheet controller. */
export default function Navigation({
  location,
  previous,
  next,
  readingTitle,
  view,
  menuToggle,
  actions,
  data,
}: Props) {
  const model = navigationModel(location, {
    readingTitle,
    selected: data.selected,
  });
  const sheet = useSheetController();
  // After the page settles, fetch the sheets this reader is likely to open.
  const picker = model.chrono
    ? loadChronologyPanel
    : model.bible
      ? loadBiblePanel
      : loadDayPanel;
  useEffect(() => {
    if (!connectionAllowsPrefetch()) return;
    const loads = [loadAppearancePanel, picker];
    const run = () => loads.forEach((load) => warm(load)());
    let idle = 0;
    const timer = setTimeout(() => {
      idle =
        typeof requestIdleCallback === "function"
          ? requestIdleCallback(run, { timeout: 3000 })
          : (run(), 0);
    }, 2000);
    return () => {
      clearTimeout(timer);
      if (idle) cancelIdleCallback(idle);
    };
  }, [picker]);
  return (
    <>
      <Toolbar
        model={model}
        view={view}
        sheet={sheet}
        menuToggle={menuToggle}
        previous={previous}
        next={next}
        go={actions.go}
        picker={picker}
      />
      <SheetHost
        model={model}
        view={view}
        sheet={sheet}
        actions={actions}
        data={data}
      />
    </>
  );
}
