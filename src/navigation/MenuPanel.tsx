import { Suspense, useId, useRef, type ChangeEvent } from "react";
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  Download,
  Hourglass,
  Info,
  Settings,
  Upload,
  UserRound,
} from "lucide-react";
import type { ReadingTrack } from "../bible/types";
import { useProgress } from "../plan/useProgress";
import { Streak } from "../streak/lazy";
import { downloadBackup, readBackupFile } from "../plan/backup";
import { ar } from "../lib/format";
import { APP_INFO } from "../appInfo";
import {
  PLAN_NAME,
  PLAN_SUBTITLE,
  TESTAMENT_NAMES,
  TRACK_NAMES,
} from "./modes";
import logo from "../assets/favicon.svg";
import "./MenuPanel.css";

type Props = {
  /** The current track, or undefined away from reading (the calendar). */
  track?: ReadingTrack;
  chooseTrack: (track: ReadingTrack) => void;
  /** Open the reader dialog: settings for a named reader, else adding one. */
  readers: () => void;
  notify: (notice: string) => void;
  about: () => void;
  close: (action?: () => void) => void;
};

function ModeButton({
  track,
  current,
  label,
  detail,
  icon: Icon,
  choose,
}: {
  track: ReadingTrack;
  current?: ReadingTrack;
  label: string;
  detail?: string;
  icon: typeof BookOpen;
  choose: (track: ReadingTrack) => void;
}) {
  return (
    <button
      className="nav-item"
      aria-label={TRACK_NAMES[track]}
      aria-current={current === track ? "page" : undefined}
      onClick={() => choose(track)}
    >
      <Icon size={20} aria-hidden="true" />
      <span className="menu-link-label">
        {label}
        {detail && <small>{detail}</small>}
      </span>
      <ChevronLeft size={16} aria-hidden="true" />
    </button>
  );
}

export default function MenuPanel({
  track,
  chooseTrack,
  readers,
  notify,
  about,
  close,
}: Props) {
  const progress = useProgress();
  const { member, completion } = progress;
  const chronologyHeading = useId();
  const planHeading = useId();
  const readerHeading = useId();
  const input = useRef<HTMLInputElement>(null);
  const days = completion.plan.length;
  const choose = (next: ReadingTrack) => close(() => chooseTrack(next));
  async function restore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (progress.restore(await readBackupFile(file)))
        close(() =>
          notify("تمت الاستعادة كقارئ منفصل. لم تُحذف أي قراءة سابقة."),
        );
    } catch (err) {
      progress.fail(err);
    } finally {
      event.target.value = "";
    }
  }
  return (
    <>
      <div className="menu-brand">
        <img src={logo} width="56" height="56" alt="" />
        <p>
          <span>{APP_INFO.title}</span>
          <small>{APP_INFO.description}</small>
        </p>
      </div>
      <nav className="menu-links" aria-label="طرق القراءة">
        <ModeButton
          track="bible"
          current={track}
          label={TRACK_NAMES.bible}
          icon={BookOpen}
          choose={choose}
        />
        <section aria-labelledby={chronologyHeading}>
          <h3 className="menu-section" id={chronologyHeading}>
            القراءة بالترتيب الزمني
          </h3>
          {(["OT", "NT"] as const).map((testament) => (
            <ModeButton
              key={testament}
              track={`chrono:${testament}`}
              current={track}
              label={TESTAMENT_NAMES[testament]}
              detail="بحسب الترتيب الزمني"
              icon={Hourglass}
              choose={choose}
            />
          ))}
        </section>
        <section aria-labelledby={planHeading}>
          <h3 className="menu-section" id={planHeading}>
            خطة قراءة العهد الجديد
          </h3>
          <ModeButton
            track="plan"
            current={track}
            label={PLAN_NAME}
            detail={PLAN_SUBTITLE}
            icon={CalendarDays}
            choose={choose}
          />
        </section>
      </nav>
      <section className="menu-reader" aria-labelledby={readerHeading}>
        <h3 className="menu-section" id={readerHeading}>
          القارئ والتقدم
        </h3>
        <button
          className="profile"
          onClick={() => close(readers)}
          aria-label={member ? "إعدادات القارئ" : "القراء على هذا الجهاز"}
        >
          <span className="avatar" aria-hidden="true">
            {member ? member.name.charAt(0) : <UserRound size={20} />}
          </span>
          <span>
            {member?.name || "تقرأ دون اسم"}
            <small>
              {days
                ? `${ar(days)} من ١٥٠ يومًا مكتملًا`
                : "التقدم محفوظ على هذا الجهاز"}
            </small>
          </span>
          <Settings size={19} aria-hidden="true" />
        </button>
        <Suspense fallback={null}>
          <Streak />
        </Suspense>
        <details className="menu-backup">
          <summary>النسخ الاحتياطي والاستعادة</summary>
          {member && (
            <button
              className="menu-row"
              onClick={() => {
                downloadBackup(member);
                notify("تم تجهيز النسخة الاحتياطية للتنزيل.");
              }}
            >
              <Download size={18} aria-hidden="true" />
              تنزيل نسخة احتياطية
            </button>
          )}
          <button className="menu-row" onClick={() => input.current?.click()}>
            <Upload size={18} aria-hidden="true" />
            استعادة نسخة احتياطية
          </button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={restore}
            aria-label="ملف النسخة الاحتياطية"
          />
          <p>
            {member
              ? "تحتوي النسخة اسمك وتقدمك وأماكن القراءة. لا توجد مزامنة تلقائية بين الأجهزة."
              : "تُستعاد النسخة كقارئ منفصل، دون تغيير قراءتك الحالية."}
          </p>
        </details>
      </section>
      <footer className="menu-footer">
        <div className="menu-source">
          <p>النص: ترجمة فان دايك · ملكية عامة</p>
          <p>
            بيانات النص من{" "}
            <a href={APP_INFO.scriptureSource} target="_blank" rel="noreferrer">
              eBible.org
            </a>
          </p>
        </div>
        <button className="about-link" onClick={about}>
          <Info size={13} aria-hidden="true" />
          <span>عن التطبيق</span>
        </button>
      </footer>
    </>
  );
}
