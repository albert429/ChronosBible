import { catalog, findBibleBook } from "../../core/scripture/catalog.ts";
import type { ReadingLocation } from "../../core/reading/types.ts";
import { trackOf } from "../../core/reading/identity.ts";
import {
  chapterLabel,
  dayLabel,
  readingLabel,
  TRACK_NAMES,
} from "../../core/reading/labels.ts";

export type View = "read" | "calendar";
export type Panel =
  "menu" | "day" | "appearance" | "about" | "bible" | "chronology";

/**
 * Moving to a passage of the open reading, supplied by the app from the
 * reader: its link address, and the jump, run once the sheet has closed.
 */
export type PassageJump = {
  href: (index: number) => string;
  jump: (index: number) => void;
};

const ADJACENT_LABELS = {
  bible: ["الإصحاح السابق", "الإصحاح التالي"],
  plan: ["اليوم السابق", "اليوم التالي"],
  chronological: ["القراءة السابقة", "القراءة التالية"],
} as const;

/**
 * What the toolbar and its sheets show for the current place: the compact
 * place line, the chevrons' labels, the picker sheet for this mode and every
 * sheet's title.
 */
export function navigationModel(
  location: ReadingLocation,
  /** The chronological reading's title, "" while its catalog loads. */
  readingTitle: string,
  /** The reader's plan day. */
  selected: number,
) {
  const track = trackOf(location);
  const bible = location.mode === "bible" ? location : undefined;
  const chrono = location.mode === "chronological" ? location : undefined;
  const place = bible
    ? chapterLabel(findBibleBook(catalog, bible.book)!.name, bible.chapter)
    : chrono
      ? readingTitle
      : dayLabel(selected);
  const pickerPanel: Panel = bible ? "bible" : chrono ? "chronology" : "day";
  const pickerLabel = bible
    ? `اختيار السفر والإصحاح: ${place}`
    : chrono
      ? `فهرس ${TRACK_NAMES[track]}: ${place || "جارٍ التحميل"}`
      : `تفاصيل ${place} · ${TRACK_NAMES.plan}`;
  const titles: Record<Panel, string> = {
    menu: "القائمة",
    bible: TRACK_NAMES.bible,
    day: readingLabel(selected),
    chronology: TRACK_NAMES[track],
    about: "عن التطبيق",
    appearance: "إعدادات القراءة",
  };
  return {
    track,
    bible,
    chrono,
    place,
    /** The chevrons' labels: previous, next. */
    adjacentLabels: ADJACENT_LABELS[location.mode],
    pickerPanel,
    pickerLabel,
    titles,
  };
}
export type NavigationModel = ReturnType<typeof navigationModel>;
