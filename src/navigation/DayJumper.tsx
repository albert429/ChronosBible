import { useId, useState } from "react";
import { Check } from "lucide-react";
import { ar } from "../lib/format";
import { useResource } from "../lib/useResource";
import { dayLabel } from "../plan/labels";
import { planIndex } from "../plan/readings";
import {
  PAGE_COUNT,
  PAGE_SIZE,
  dayStatus,
  pageFor,
  type DayStatus,
} from "../plan/schedule";
import { StreakRibbon } from "../streak/Streak";
import "./DayJumper.css";

const STATUS_LABELS: Record<DayStatus, string> = {
  done: "مكتمل",
  today: "قراءة اليوم",
  behind: "للمتابعة",
  ahead: "قادم",
};

/**
 * Every plan day, thirty at a time, from the day menu. Tapping a day opens
 * it; done, today, behind and the open day look different without colour.
 */
export default function DayJumper({
  selected,
  current,
  completed,
  go,
}: {
  selected: number;
  /** Today's plan day for this reader (clamped to the plan). */
  current: number;
  completed: readonly number[];
  go: (day: number) => void;
}) {
  const heading = useId();
  const [page, setPage] = useState(() => pageFor(selected));
  // Book names make each day's accessible name more useful; optional.
  const { data: plan } = useResource(planIndex, "plan");
  const done = new Set(completed);
  const first = page * PAGE_SIZE + 1;
  return (
    <>
      <div className="day-streak">
        <StreakRibbon />
      </div>
      <section className="day-jumper" aria-labelledby={heading}>
        <h3 id={heading}>اذهب إلى يوم</h3>
        <div className="jumper-ranges" role="group" aria-label="مجموعات الأيام">
          {Array.from({ length: PAGE_COUNT }, (_, p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === page}
              aria-label={`الأيام ${ar(p * PAGE_SIZE + 1)} إلى ${ar((p + 1) * PAGE_SIZE)}`}
              onClick={() => setPage(p)}
            >
              {ar(p * PAGE_SIZE + 1)}–{ar((p + 1) * PAGE_SIZE)}
            </button>
          ))}
        </div>
        <ol className="jumper-grid">
          {Array.from({ length: PAGE_SIZE }, (_, i) => {
            const day = first + i;
            const status = dayStatus(day, current, done.has(day));
            const books = plan
              ? [...new Set(plan[day - 1].passages.map((p) => p.book))].join(
                  "، ",
                )
              : "";
            const label = [
              books ? `${dayLabel(day)}: ${books}` : dayLabel(day),
              STATUS_LABELS[status],
              day === selected ? "مفتوح الآن" : "",
            ]
              .filter(Boolean)
              .join("، ");
            return (
              <li key={day}>
                <button
                  type="button"
                  className="jumper-day"
                  data-status={status}
                  data-open={day === selected || undefined}
                  data-today={day === current || undefined}
                  aria-current={day === current ? "date" : undefined}
                  aria-label={label}
                  onClick={() => go(day)}
                >
                  <span>{ar(day)}</span>
                  {status === "done" && <Check size={12} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
