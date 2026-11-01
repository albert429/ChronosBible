import type { RefObject } from "react";
import {
  Menu,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Settings,
} from "lucide-react";
import type { ReadingLocation } from "../../domain/reading/types";
import { TRACK_NAMES } from "../../domain/reading/labels";
import type { NavigationModel, View } from "./model";
import type { SheetController } from "./useSheetController";
import { loadAppearancePanel, warm } from "./panels";
import logo from "../../assets/favicon.svg";
import "./Toolbar.css";

/** The sticky top bar: menu, paging around the place picker, appearance. */
export default function Toolbar({
  model,
  view,
  sheet,
  menuToggle,
  previous,
  next,
  go,
  picker,
}: {
  model: NavigationModel;
  view: View;
  sheet: SheetController;
  menuToggle: RefObject<HTMLButtonElement | null>;
  previous?: ReadingLocation;
  next?: ReadingLocation;
  go: (location: ReadingLocation) => void;
  /** Loads the picker sheet for this mode. */
  picker: () => Promise<unknown>;
}) {
  return (
    <>
      <a className="skip-link" href="#main">
        انتقل إلى المحتوى
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <button
            ref={menuToggle}
            className="icon-button menu-toggle"
            aria-label="فتح القائمة"
            aria-haspopup="dialog"
            aria-expanded={sheet.expanded("menu")}
            onClick={(event) => sheet.show("menu", event.currentTarget)}
          >
            <img src={logo} width="28" height="28" alt="" />
            <Menu size={16} aria-hidden="true" />
          </button>
          {view === "read" ? (
            <>
              <button
                className="icon-button previous-day"
                disabled={!previous}
                onClick={() => previous && go(previous)}
                aria-label={model.previousLabel}
              >
                <ChevronRight size={20} aria-hidden="true" />
              </button>
              <h1 className="toolbar-day">
                <button
                  className="day-trigger"
                  aria-label={model.pickerLabel}
                  aria-haspopup="dialog"
                  aria-expanded={sheet.expanded(model.pickerPanel)}
                  data-track={model.track}
                  onPointerDown={warm(picker)}
                  onFocus={warm(picker)}
                  onClick={(event) =>
                    sheet.show(model.pickerPanel, event.currentTarget)
                  }
                >
                  <span className="toolbar-place">
                    <small aria-hidden="true">{model.trackName}</small>
                    <span>{model.place || "…"}</span>
                  </span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </h1>
              <button
                className="icon-button next-day"
                disabled={!next}
                onClick={() => next && go(next)}
                aria-label={model.nextLabel}
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
            </>
          ) : (
            <div className="toolbar-title">{TRACK_NAMES.plan}</div>
          )}
          <button
            className="icon-button appearance-toggle"
            aria-label="إعدادات القراءة"
            aria-haspopup="dialog"
            aria-expanded={sheet.expanded("appearance")}
            onPointerDown={warm(loadAppearancePanel)}
            onFocus={warm(loadAppearancePanel)}
            onClick={(event) => sheet.show("appearance", event.currentTarget)}
          >
            <Settings size={20} aria-hidden="true" />
          </button>
        </div>
      </header>
    </>
  );
}
