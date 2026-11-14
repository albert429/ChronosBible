// Sheet contents load apart from the reader: warmed when the page is idle,
// and by pressing or focusing their button, so opening one does not wait.
// The menu, every reader's way around, stays in the main bundle.
export const loadChronologyPanel = () =>
  import("../chronology/ChronologyPanel");
export const loadBiblePanel = () => import("../bible/BiblePanel");
export const loadDayPanel = () =>
  Promise.all([import("../plan/DayPanel"), import("../plan/DayJumper")]).then(
    ([panel]) => panel,
  );
export const loadAppearancePanel = () =>
  import("../appearance/AppearancePanel");
export const loadAbout = () => import("./About");

export const warm = (load: () => Promise<unknown>) => () =>
  void load().catch(() => {});
