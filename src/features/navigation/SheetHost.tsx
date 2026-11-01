import { lazy, Suspense, useState } from "react";
import { Share2 } from "lucide-react";
import type {
  ReadingLocation,
  BibleLocation,
  ChronologicalLocation,
  Day,
} from "../../domain/reading/types";
import type { ReadingTrack } from "../../domain/reading/identity";
import type { ChronologyCatalog } from "../../domain/reading/chronology";
import type { TrackCompletion } from "../../domain/profiles/state";
import { ChunkBoundary, Loading } from "../../shared/ui/Feedback";
import Sheet from "../../shared/ui/Sheet";
import { shareApp } from "./share";
import MenuPanel from "./MenuPanel";
import type { NavigationModel, PassageJump, View } from "./model";
import type { SheetController } from "./useSheetController";
import {
  loadAbout,
  loadAppearancePanel,
  loadBiblePanel,
  loadChronologyPanel,
  loadDayPanel,
} from "./panels";
const About = lazy(loadAbout);
const ChronologyPanel = lazy(loadChronologyPanel);
const BiblePanel = lazy(loadBiblePanel);
const DayPanel = lazy(loadDayPanel);
const AppearancePanel = lazy(loadAppearancePanel);

export type SheetActions = {
  go: (location: ReadingLocation) => void;
  chooseTrack: (track: ReadingTrack) => void;
  navigate: (view: View) => void;
  readers: () => void;
  invite: (text: string) => void;
  notify: (notice: string) => void;
  goDay: (day: number) => void;
  passages: PassageJump;
};
export type SheetData = {
  chronology?: ChronologyCatalog;
  chronologyError?: string;
  retryChronology: () => void;
  completion: TrackCompletion;
  continuous: boolean;
  setContinuous: (enabled: boolean) => void;
  selected: number;
  reading?: Day;
  readingError?: string;
  retryReading: () => void;
};

/**
 * The one navigation sheet and its panels. Every action that leaves the
 * sheet waits until it has closed and returned focus (see useSheetController).
 */
export default function SheetHost({
  model,
  view,
  sheet,
  actions,
  data,
}: {
  model: NavigationModel;
  view: View;
  sheet: SheetController;
  actions: SheetActions;
  data: SheetData;
}) {
  const { panel, close, show } = sheet;
  const { track, bible, chrono } = model;
  const [sharing, setSharing] = useState(false);
  async function share() {
    if (sharing) return;
    setSharing(true);
    let fallback;
    try {
      fallback = await shareApp();
    } finally {
      setSharing(false);
    }
    if (fallback) close(() => actions.invite(fallback));
  }
  return (
    <Sheet
      open={sheet.open}
      returnFocusTo={sheet.trigger}
      title={model.titles[panel]}
      keepsAudio={panel === "appearance"}
      headerActions={
        panel === "menu" ? (
          <button
            type="button"
            className="icon-button"
            aria-label="مشاركة التطبيق"
            disabled={sharing}
            onClick={share}
          >
            <Share2 size={20} aria-hidden="true" />
          </button>
        ) : undefined
      }
      onClose={() => close()}
      onAfterClose={sheet.closed}
    >
      <ChunkBoundary key={panel}>
        <Suspense fallback={<Loading label="جارٍ الفتح…" />}>
          {panel === "menu" ? (
            <MenuPanel
              track={view === "read" ? track : undefined}
              chooseTrack={actions.chooseTrack}
              readers={actions.readers}
              notify={actions.notify}
              close={close}
              about={() => {
                const trigger = sheet.trigger;
                close(() => {
                  if (trigger) show("about", trigger);
                });
              }}
            />
          ) : panel === "bible" && bible ? (
            <BiblePanel
              location={bible}
              go={actions.go as (location: BibleLocation) => void}
              close={close}
            />
          ) : panel === "chronology" && chrono ? (
            <ChronologyPanel
              chronology={data.chronology}
              error={data.chronologyError}
              retry={data.retryChronology}
              location={chrono}
              completed={data.completion[track as `chrono:${"OT" | "NT"}`]}
              go={actions.go as (location: ChronologicalLocation) => void}
              close={close}
            />
          ) : panel === "day" ? (
            <DayPanel
              selected={data.selected}
              reading={data.reading}
              readingError={data.readingError}
              retryReading={data.retryReading}
              go={actions.goDay}
              navigate={actions.navigate}
              close={close}
              passageHref={actions.passages.href}
              jump={(index) => close(() => actions.passages.jump(index))}
            />
          ) : panel === "appearance" ? (
            <AppearancePanel
              continuous={data.continuous}
              setContinuous={data.setContinuous}
            />
          ) : panel === "about" ? (
            <About />
          ) : null}
        </Suspense>
      </ChunkBoundary>
    </Sheet>
  );
}
