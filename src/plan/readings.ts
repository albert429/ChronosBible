import { createJsonClient } from "../lib/jsonClient.ts";
import { dataUrl } from "../lib/dataVersion.ts";
import { PLAN_DAYS, isPlanDay } from "./schedule.ts";

export type Verse = { number: number; text: string; heading?: string };
export type PassageRef = {
  book: string;
  chapter: number;
  start: number;
  end: number;
};
export type Passage = PassageRef & { verses: Verse[] };
export type PlanEntry = {
  day: number;
  verseCount: number;
  passages: PassageRef[];
};
export type Day = Omit<PlanEntry, "passages"> & { passages: Passage[] };

const validEntry = (entry: PlanEntry) =>
  entry && Number.isInteger(entry.day) && Array.isArray(entry.passages);

// Public Scripture only. Personal progress stays in the existing storage module.
export function createReadingsClients(
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
) {
  const planIndex = createJsonClient<PlanEntry[]>(
    {
      url: () => dataUrl("/readings/plan.json"),
      validate: (data): data is PlanEntry[] =>
        Array.isArray(data) &&
        data.length === PLAN_DAYS &&
        data.every(validEntry),
      message: () => "تعذر تحميل خطة القراءة. تحقق من الاتصال وحاول مرة أخرى.",
    },
    fetcher,
    timeoutMs,
  );
  const dayClient = createJsonClient<Day>(
    {
      url: (key) => dataUrl(`/readings/${key}.json`),
      validate: (data, key): data is Day =>
        validEntry(data as Day) && (data as Day).day === Number(key),
      message: () => "تعذر تحميل القراءة. تحقق من الاتصال وحاول مرة أخرى.",
    },
    fetcher,
    timeoutMs,
  );
  const days = {
    ...dayClient,
    // Background failures are intentionally silent; load retains normal retry behavior.
    prefetchDay: (day: number): Promise<void> => {
      if (!isPlanDay(day)) return Promise.resolve();
      return dayClient.load(String(day)).then(
        () => {},
        () => {},
      );
    },
  };
  return { planIndex, days };
}
export const { planIndex, days } = createReadingsClients();
