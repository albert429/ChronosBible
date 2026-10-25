import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { ar, dateLabel } from "../lib/format";
import { dayLabel } from "./labels";
import {
  PAGE_COUNT,
  PAGE_SIZE,
  PLAN_DAYS,
  dateFor,
  dayStatus,
} from "./schedule";
import type { Reader } from "./progress";
import { planIndex } from "./readings";
import { useResource } from "../lib/useResource";
import { Loading, LoadError } from "../components/Feedback";
import { StreakChip } from "../streak/Streak";
import "./Calendar.css";

const STATUS_LABELS = {
  done: "مكتمل",
  today: "اليوم",
  behind: "للمتابعة",
  ahead: "قادم",
};

export default function Calendar({
  member,
  completed,
  start,
  current,
  page,
  setPage,
  go,
}: {
  member: Reader | null;
  completed: readonly number[];
  start: string;
  current: number;
  page: number;
  setPage: (page: number) => void;
  go: (day: number) => void;
}) {
  const { data: plan, error, retry } = useResource(planIndex, "plan");
  const count = completed.length;
  return (
    <section className="calendar-panel" aria-label="أيام خطة القراءة">
      <div className="calendar-summary">
        <div>
          <span className="eyebrow">خطوة، كل يوم</span>
          <p className="progress-number">
            {ar(count)}
            <span> / ١٥٠ يومًا</span>
          </p>
          <StreakChip />
        </div>
        <p>
          {member
            ? `بدأت رحلتك في ${dateLabel(start)}`
            : "التقدم محفوظ على هذا الجهاز. التواريخ تبدأ من اليوم حتى تختار تاريخ بدايتك."}
        </p>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="تقدم القراءة"
        aria-valuenow={count}
        aria-valuemin={0}
        aria-valuemax={PLAN_DAYS}
      >
        <i style={{ width: `${(count / PLAN_DAYS) * 100}%` }} />
      </div>
      <div className="calendar-header">
        <h2>أيام الرحلة</h2>
        <div className="stepper">
          <button
            className="icon-button"
            aria-label="الأيام السابقة"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            <ChevronRight size={20} />
          </button>
          <span aria-live="polite">
            {ar(page * PAGE_SIZE + 1)} – {ar((page + 1) * PAGE_SIZE)}
          </span>
          <button
            className="icon-button"
            aria-label="الأيام التالية"
            disabled={page === PAGE_COUNT - 1}
            onClick={() => setPage(page + 1)}
          >
            <ChevronLeft size={20} />
          </button>
        </div>
      </div>
      {error ? (
        <LoadError message={error} retry={retry} />
      ) : !plan ? (
        <Loading label="جارٍ تحميل خطة القراءة…" />
      ) : (
        <div className="calendar-grid">
          {plan.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((day) => {
            const complete = completed.includes(day.day);
            // Past and today style the card whether or not the day is complete.
            const position = dayStatus(day.day, current, false);
            const status = STATUS_LABELS[complete ? "done" : position];
            return (
              <button
                key={day.day}
                onClick={() => go(day.day)}
                aria-current={position === "today" ? "date" : undefined}
                className={`calendar-day ${complete ? "completed" : ""} ${position === "today" ? "today" : position === "behind" ? "missed" : ""}`}
              >
                <span className="calendar-day-top">
                  {dayLabel(day.day)}
                  {complete && <Check size={18} />}
                </span>
                <strong>
                  {[...new Set(day.passages.map((p) => p.book))].join("، ")}
                </strong>
                <small>{dateLabel(dateFor(start, day.day))}</small>
                <span className="calendar-day-meta">
                  <span>{ar(day.verseCount)} آية</span>
                  <span>{status}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="calendar-footer">
        لكل شخص جدوله الخاص. يمكنك تعويض أي يوم أو القراءة مسبقًا.
        <span>توقيت القاهرة</span>
      </p>
    </section>
  );
}
