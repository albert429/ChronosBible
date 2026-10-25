import { lazy, Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { ChunkBoundary, Loading } from "../components/Feedback";
import { scheduledDay } from "./schedule";
import type { Reader } from "./progress";
const Calendar = lazy(() => import("./Calendar"));

type Props = {
  member: Reader | null;
  /** Completed plan days: the named reader's, else this device's guest's. */
  completed: readonly number[];
  start: string;
  currentDate: string;
  current: number;
  page: number;
  setPage: (page: number) => void;
  go: (day: number) => void;
  join: () => void;
};
export default function PlanView({
  member,
  completed,
  start,
  currentDate,
  current,
  page,
  setPage,
  go,
  join,
}: Props) {
  return (
    <>
      <section className="page-heading">
        <div>
          <span className="eyebrow">خطة شباب كنيسة الإخوة بخلوصي</span>
          <h1>العهد الجديد في ١٥٠ يومًا</h1>
          <p>تابع الأيام المكتملة، وعُد إلى أي قراءة.</p>
        </div>
        <div className="page-heading-actions">
          <button
            className="quiet-button"
            onClick={() => go(scheduledDay(start, currentDate))}
          >
            قراءة اليوم
            <ArrowLeft size={18} />
          </button>
          {!member && (
            <button className="text-button" onClick={join}>
              اختيار تاريخ البداية
            </button>
          )}
        </div>
      </section>
      <ChunkBoundary>
        <Suspense fallback={<Loading label="جارٍ فتح خطة القراءة…" />}>
          <Calendar
            member={member}
            completed={completed}
            start={start}
            current={current}
            page={page}
            setPage={setPage}
            go={go}
          />
        </Suspense>
      </ChunkBoundary>
    </>
  );
}
