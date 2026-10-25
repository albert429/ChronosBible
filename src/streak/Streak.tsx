import { useEffect, useId, useRef } from "react";
import { ar } from "../lib/format";
import { useToday } from "../lib/useToday";
import { useProgress } from "../plan/useProgress";
import {
  STREAK_MILESTONES,
  streakStats,
  type StreakStats,
} from "../plan/streak";
import "./Streak.css";

/** «يوم واحد»، «يومان متتاليان»، «٣ أيام متتالية»، «١٢ يومًا متتاليًا». */
export function streakLabel(n: number) {
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومان متتاليان";
  const tens = n % 100;
  if (tens >= 3 && tens <= 10) return `${ar(n)} أيام متتالية`;
  if (tens >= 11) return `${ar(n)} يومًا متتاليًا`;
  return `${ar(n)} يوم متتالٍ`;
}
/** A plain count of days: «يوم واحد»، «يومان»، «٣ أيام»، «١٢ يومًا». */
function daysLabel(n: number) {
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومان";
  const tens = n % 100;
  if (tens >= 3 && tens <= 10) return `${ar(n)} أيام`;
  return `${ar(n)} ${tens >= 11 ? "يومًا" : "يوم"}`;
}

/** The active reader's (or the guest's) streak, as of today in Cairo. */
function useStreak(): StreakStats & {
  readings: string[];
  today: string;
  planDays: number;
} {
  const { readOn, completion } = useProgress();
  const today = useToday();
  return {
    ...streakStats(readOn, today),
    readings: Object.values(readOn),
    today,
    planDays: completion.plan.length,
  };
}

/** The next milestone above `n`, or the last one. */
const nextMilestone = (n: number) =>
  STREAK_MILESTONES.find((m) => m > n) ?? STREAK_MILESTONES.at(-1)!;

export function Flame({ lit, size = 24 }: { lit: boolean; size?: number }) {
  return (
    <svg
      className="flame"
      data-lit={lit || undefined}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path
        className="flame-outer"
        d="M12 1.8c1.7 3.6 5.6 5.6 5.6 10.8a5.6 5.6 0 0 1-11.2 0c0-2.5 1.1-4.3 2.6-5.6.2 1.8 1.1 3 2.4 3.6C10.9 7.4 11.1 4.3 12 1.8z"
      />
      <path
        className="flame-core"
        d="M12 13c1.2 1.4 2.3 2.3 2.3 3.8a2.3 2.3 0 0 1-4.6 0c0-1.2.8-2.1 2.3-3.8z"
      />
    </svg>
  );
}

/** A flame inside a ring that fills toward the next milestone. */
function FlameRing({ current }: { current: number }) {
  const target = nextMilestone(current);
  const r = 26;
  const length = 2 * Math.PI * r;
  const filled = Math.min(1, current / target);
  return (
    <span className="flame-ring" aria-hidden="true">
      <svg viewBox="0 0 60 60" width="60" height="60">
        <circle className="ring-track" cx="30" cy="30" r={r} />
        <circle
          className="ring-fill"
          cx="30"
          cy="30"
          r={r}
          strokeDasharray={length}
          strokeDashoffset={length * (1 - filled)}
        />
      </svg>
      <Flame lit={current > 0} size={28} />
    </span>
  );
}

const WEEK_WORDS = {
  read: "قراءة",
  rest: "يوم راحة",
  miss: "دون قراءة",
  today: "اليوم، لم تُعلَّم قراءة بعد",
  idle: "",
};

/** The streak card for the menu and the plan's day menu. */
export function StreakRibbon() {
  const id = useId();
  const { current, best, readToday, atRisk, week } = useStreak();
  const rests = week.filter((mark) => mark === "rest").length;
  const reads = week.filter((mark) => mark === "read").length;
  const note = readToday
    ? "قرأت اليوم. أحسنت!"
    : atRisk
      ? "اقرأ اليوم لتحافظ على سلسلتك."
      : best
        ? "ابدأ من جديد، كل يوم بداية جديدة."
        : "علّم أي قراءة كمكتملة لتبدأ سلسلتك.";
  return (
    <section
      className="streak"
      aria-labelledby={id}
      data-state={readToday ? "lit" : atRisk ? "risk" : "idle"}
    >
      <FlameRing current={current} />
      <div className="streak-text">
        <h3 id={id}>سلسلة القراءة</h3>
        <p className="streak-count">
          {current ? streakLabel(current) : "ابدأ سلسلتك اليوم"}
        </p>
        <p className="streak-note">{note}</p>
        {best > current && (
          <p className="streak-best">أفضل سلسلة: {daysLabel(best)}</p>
        )}
        <span
          className="streak-week"
          role="img"
          aria-label={`آخر سبعة أيام: ${reads ? `قراءة في ${daysLabel(reads)}` : "دون قراءة"}${rests ? "، ويوم راحة" : ""}`}
        >
          {week.map((mark, i) => (
            <i key={i} data-mark={mark} title={WEEK_WORDS[mark] || undefined} />
          ))}
        </span>
      </div>
    </section>
  );
}

/** A short chip for the plan calendar's summary. */
export function StreakChip() {
  const { current, readToday } = useStreak();
  if (!current) return null;
  return (
    <span
      className="streak-chip"
      role="img"
      aria-label={`سلسلة القراءة: ${streakLabel(current)}`}
    >
      <Flame lit={readToday} size={16} />
      {ar(current)}
    </span>
  );
}

const STREAK_LINES: Record<number, string> = {
  3: "بداية جميلة، استمر.",
  7: "أسبوع كامل مع كلمة الله.",
  14: "أسبوعان من الأمانة اليومية.",
  30: "شهر كامل! عادة جميلة تُبنى.",
  50: "خمسون يومًا من القراءة. ثبات يُفرح.",
  100: "مئة يوم! ثباتك مُلهم.",
  150: "مئة وخمسون يومًا متتالية!",
};
const PLAN_MARKS: Record<number, [string, string]> = {
  38: ["ربع الخطة", "أكملت ربع العهد الجديد في ١٥٠ يومًا."],
  75: ["نصف الخطة", "نصف الطريق! استمر بنفس الأمانة."],
  113: ["ثلاثة أرباع الخطة", "اقتربت من النهاية، أكمل الرحلة."],
  150: ["أكملت الخطة!", "قرأت العهد الجديد كاملًا في ١٥٠ يومًا."],
};

/**
 * Under a completed reading: the streak, lit and counted up when this reading
 * was the first today (`cheer`), with a milestone card when one is reached.
 */
export function StreakMoment({
  cheer,
  plan: inPlan,
}: {
  /** The reader just marked this reading done here. */
  cheer: boolean;
  /** A youth plan reading: plan milestones apply. */
  plan?: boolean;
}) {
  const { current, readings, today, planDays: count } = useStreak();
  const planDays = inPlan ? count : 0;
  // Only the day's first reading moves the streak.
  const grew = cheer && readings.filter((d) => d === today).length === 1;
  const streakLine = grew ? STREAK_LINES[current] : undefined;
  const plan = cheer && planDays ? PLAN_MARKS[planDays] : undefined;
  const big = (grew && current >= 30) || planDays === 150;
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!card.current) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Above the bottom toast, and a short buzz where phones support it.
    card.current.scrollIntoView({
      block: "center",
      behavior: still ? "auto" : "smooth",
    });
    if (!still) navigator.vibrate?.(12);
  }, [streakLine, plan]);
  if (!current) return null;
  return (
    <div className="streak-moment" data-cheer={grew || undefined}>
      <p className="streak-moment-line">
        <Flame lit size={22} />
        <span>
          سلسلة القراءة: <strong key={current}>{streakLabel(current)}</strong>
        </span>
      </p>
      {(streakLine || plan) && (
        <div className="streak-milestone" role="status" ref={card}>
          {big && (
            <span className="sparks" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} style={{ "--a": `${i * 45}deg` } as object} />
              ))}
            </span>
          )}
          <Flame lit size={36} />
          <strong>{plan ? plan[0] : `${streakLabel(current)}!`}</strong>
          <p>{plan ? plan[1] : streakLine}</p>
        </div>
      )}
    </div>
  );
}

export type StreakSlotProps = {
  /** Under a completed reading, else the streak card. */
  moment?: boolean;
  cheer?: boolean;
  plan?: boolean;
};
/** The one lazily loaded entry point (see `lazy.ts`). */
export function StreakSlot({ moment, cheer = false, plan }: StreakSlotProps) {
  return moment ? <StreakMoment cheer={cheer} plan={plan} /> : <StreakRibbon />;
}
