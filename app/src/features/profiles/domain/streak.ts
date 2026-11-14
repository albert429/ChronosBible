// Reading streaks: consecutive Cairo dates with at least one completed
// reading, in any track. One missed date is forgiven as a rest day («يوم
// راحة») when no other forgiven date lies within the 6 days before or after
// it; two missed dates in a row end a streak. Pure, so it is easy to test.

const DAY = 86400000;
/** A YYYY-MM-DD date as a day number (UTC noon, like `dayIndex`). */
const ordinal = (date: string) =>
  Math.round(Date.parse(date + "T12:00:00Z") / DAY);
/** Rest days must be at least this many days apart. */
const REST_GAP = 7;

export type WeekMark = "read" | "rest" | "miss" | "today" | "idle";
export type StreakStats = {
  /** Read dates in the streak that is still alive (today counts if read). */
  current: number;
  /** The longest streak so far, never less than `current`. */
  best: number;
  readToday: boolean;
  /** A streak is alive but today has no reading yet. */
  atRisk: boolean;
  /** The last seven dates, oldest first, ending today. */
  week: WeekMark[];
};

/**
 * The streak ending on `end`, walking back. `end` itself may be unread only
 * when it is today (still pending). Returns the count and the forgiven dates.
 */
function chainEnding(read: ReadonlySet<number>, end: number, today: number) {
  const rest = new Set<number>();
  let count = 0;
  let lastRest = Infinity;
  let day = end;
  if (day === today && !read.has(day)) day -= 1;
  for (;;) {
    if (read.has(day)) {
      count += 1;
      day -= 1;
    } else if (read.has(day - 1) && lastRest - day >= REST_GAP) {
      // A single missed date before more reading: a rest day.
      rest.add(day);
      lastRest = day;
      day -= 1;
    } else break;
  }
  return { count, rest };
}

export function streakStats(
  readOn: Readonly<Record<string, string>>,
  todayDate: string,
): StreakStats {
  const today = ordinal(todayDate);
  const read = new Set(
    Object.values(readOn)
      .map(ordinal)
      .filter((day) => Number.isFinite(day) && day <= today),
  );
  const readToday = read.has(today);
  const { count: current, rest } = chainEnding(read, today, today);
  let best = current;
  for (const day of read)
    // Only a read date with no reading the day after can end a longer chain.
    if (!read.has(day + 1) && day !== today)
      best = Math.max(best, chainEnding(read, day, today).count);
  const first = Math.min(...read);
  const week = Array.from({ length: 7 }, (_, i): WeekMark => {
    const day = today - 6 + i;
    if (read.has(day)) return "read";
    if (day === today) return "today";
    if (rest.has(day)) return "rest";
    return day > first ? "miss" : "idle";
  });
  return {
    current,
    best,
    readToday,
    atRisk: current > 0 && !readToday,
    week,
  };
}

/** Streak lengths that earn a milestone card. */
export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 150] as const;
