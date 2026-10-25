import { ar } from "../lib/format.ts";
import type { ReadingTrack, Testament } from "../bible/types.ts";
import type { ChronologicalReadingSummary } from "../chronology/types.ts";

export const TESTAMENT_NAMES: Record<Testament, string> = {
  OT: "العهد القديم",
  NT: "العهد الجديد",
};
export const PLAN_NAME = "العهد الجديد في ١٥٠ يومًا";
export const PLAN_SUBTITLE = "خطة يومية لقراءة العهد الجديد كاملًا";

/** Each track's full name, for menus and accessible labels. */
export const TRACK_NAMES: Record<ReadingTrack, string> = {
  bible: "الكتاب المقدس",
  plan: PLAN_NAME,
  "chrono:OT": "العهد القديم بالترتيب الزمني",
  "chrono:NT": "العهد الجديد بالترتيب الزمني",
};
/** The toolbar's short mode line above the current place. */
export const TRACK_SHORT_NAMES: Record<ReadingTrack, string> = {
  bible: "الكتاب المقدس",
  plan: "خطة ١٥٠ يومًا",
  "chrono:OT": "زمني · العهد القديم",
  "chrono:NT": "زمني · العهد الجديد",
};

/** Arabic counted nouns: one, two, three to ten, eleven and above. */
function counted(
  n: number,
  [one, two, few, many]: [string, string, string, string],
) {
  if (n === 1) return one;
  if (n === 2) return two;
  return `${ar(n)} ${n % 100 >= 3 && n % 100 <= 10 ? few : many}`;
}
export const minutesLabel = (minutes: number) =>
  counted(Math.max(1, Math.round(minutes)), [
    "دقيقة واحدة",
    "دقيقتان",
    "دقائق",
    "دقيقة",
  ]);
/** An estimated reading time, «نحو ساعتين و١٥ دقيقة» style. */
export function durationLabel(minutes: number) {
  const total = Math.max(1, Math.round(minutes));
  if (total < 60) return minutesLabel(total);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const hoursText = counted(hours, ["ساعة", "ساعتان", "ساعات", "ساعة"]);
  return rest ? `${hoursText} و${minutesLabel(rest)}` : hoursText;
}

/**
 * Where «متابعة القراءة» leads: the first unfinished reading from the current
 * one on, else the earliest unfinished; undefined once all are complete.
 */
export function continueReading(
  readings: readonly ChronologicalReadingSummary[],
  current: string,
  done: ReadonlySet<string>,
) {
  const from = Math.max(
    0,
    readings.findIndex((reading) => reading.id === current),
  );
  return (
    readings.slice(from).find((reading) => !done.has(reading.id)) ??
    readings.find((reading) => !done.has(reading.id))
  );
}
