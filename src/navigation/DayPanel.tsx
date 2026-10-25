import { lazy, Suspense } from "react";
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Day } from "../plan/readings";
import type { View } from "./Navigation";
import { dateLabel } from "../lib/format";
import {
  PLAN_DAYS,
  clampDay,
  dateFor,
  dayIndex,
  dayStatus,
} from "../plan/schedule";
import { useProgress } from "../plan/useProgress";
import { useToday } from "../lib/useToday";
import { ChunkBoundary, Loading, LoadError } from "../components/Feedback";
import PassageReference from "../components/PassageReference";
import { passageId } from "../reader/scriptureDom";
import "./DayPanel.css";

/** Also called from the day button, so the grid is ready when the menu opens. */
export const loadDayJumper = () => import("./DayJumper");
const DayJumper = lazy(loadDayJumper);

const STATUS_LABELS = {
  done: "مكتمل",
  today: "قراءة اليوم",
  ahead: "قراءة مسبقة",
  behind: "للمتابعة",
};

type Props = {
  selected: number;
  reading?: Day;
  readingError?: string;
  retryReading: () => void;
  go: (day: number) => void;
  navigate: (view: View) => void;
  close: (action?: () => void) => void;
  jump: (index: number) => void;
};
export default function DayPanel({
  selected,
  reading,
  readingError,
  retryReading,
  go,
  navigate,
  close,
  jump,
}: Props) {
  const { member, completion } = useProgress();
  const today = useToday();
  const start = member?.startDate || today;
  const done = completion.plan.includes(selected);
  const currentDay = clampDay(dayIndex(start, today));
  const status = dayStatus(selected, currentDay, done);
  return (
    <>
      <div className="day-sheet-meta">
        <p>{dateLabel(dateFor(start, selected))}</p>
        <span className={`tag ${done ? "complete" : ""}`}>
          {STATUS_LABELS[status]}
        </span>
      </div>
      {readingError ? (
        <LoadError message={readingError} retry={retryReading} />
      ) : !reading ? (
        <Loading />
      ) : (
        <ol className="passage-list" aria-label="مقاطع القراءة">
          {reading.passages.map((passage, index) => (
            <li key={index}>
              <a
                href={`#${passageId(index)}`}
                onClick={(event) => {
                  event.preventDefault();
                  jump(index);
                }}
              >
                <span>
                  {passage.book} <PassageReference passage={passage} />
                </span>
                <ChevronLeft size={16} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ol>
      )}
      <ChunkBoundary>
        <Suspense fallback={null}>
          <DayJumper
            selected={selected}
            current={currentDay}
            completed={completion.plan}
            go={(day) => close(() => go(day))}
          />
        </Suspense>
      </ChunkBoundary>
      <div className="day-sheet-navigation" aria-label="التنقل بين الأيام">
        <button
          className="quiet-button"
          disabled={selected === 1}
          onClick={() => close(() => go(selected - 1))}
        >
          <ChevronRight size={18} aria-hidden="true" />
          اليوم السابق
        </button>
        <button
          className="quiet-button"
          disabled={selected === PLAN_DAYS}
          onClick={() => close(() => go(selected + 1))}
        >
          اليوم التالي
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="sheet-actions">
        {selected !== currentDay && (
          <button
            className="primary"
            onClick={() => close(() => go(currentDay))}
          >
            <BookOpen size={18} aria-hidden="true" />
            قراءة اليوم
          </button>
        )}
        <button
          className="quiet-button"
          onClick={() => close(() => navigate("calendar"))}
        >
          <CalendarDays size={18} aria-hidden="true" />
          أيام الخطة والتقدم
        </button>
      </div>
    </>
  );
}
