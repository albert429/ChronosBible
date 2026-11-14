export const PLAN_DAYS = 150;
export const PAGE_SIZE = 30;
export const PAGE_COUNT = PLAN_DAYS / PAGE_SIZE;

export type DayStatus = "done" | "today" | "behind" | "ahead";

export const pageFor = (day: number) => Math.floor((day - 1) / PAGE_SIZE);
export const isPlanDay = (day: number) =>
  Number.isInteger(day) && day >= 1 && day <= PLAN_DAYS;
export const clampDay = (day: number) => Math.max(1, Math.min(PLAN_DAYS, day));
export const dayIndex = (start: string, date: string) =>
  Math.floor(
    (Date.parse(date + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) /
      86400000,
  ) + 1;
/** The plan day for `date` (a Cairo YYYY-MM-DD, injected by the caller). */
export const scheduledDay = (start: string, date: string) =>
  clampDay(dayIndex(start, date));
export function dateFor(start: string, day: number) {
  const date = new Date(start + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + day - 1);
  return date.toISOString().slice(0, 10);
}

/** A day against the current day; each caller chooses the current day to pass (raw or clamped). */
export const dayStatus = (
  day: number,
  current: number,
  done: boolean,
): DayStatus =>
  done
    ? "done"
    : day === current
      ? "today"
      : day < current
        ? "behind"
        : "ahead";
