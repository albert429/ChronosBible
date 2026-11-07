import "./ai.css";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Info, RefreshCw } from "lucide-react";
import { browserStorage, turnOff, turnOn, isTurnedOff } from "./cache.ts";
import { modelLabel, parseAnswer } from "./format.ts";
import {
  CHIPS,
  cleanQuestion,
  QUESTION_MAX,
  QUESTION_MIN,
} from "../../domain/ai/chips.ts";
import { createGuards, RETRYABLE, type Problem } from "./guards.ts";
import { reportMailto } from "./report.ts";
import { startAnswer, type View } from "./request.ts";
import type { AiStatus, ChipId } from "../../domain/ai/types.ts";
import { APP_INFO } from "../../shared/lib/appInfo";
import { ar, today } from "../../shared/lib/format";
import type { Passage, Verse } from "../../domain/scripture/types";
import AiAnswer from "./AiAnswer";
import { aiStatus } from "../../data/ai/client.ts";
import AiSpark from "./AiSpark";
import { reveal } from "../../shared/ui/reveal";
import "../../shared/ui/form.css";

// Session-wide guards that protect the shared OpenRouter allowance; module
// scope, so they hold across remounts of the panel.
const guards = createGuards();

const MESSAGES: Record<Problem, string> = {
  invalid: "تعذّر إرسال الطلب. حدّث التطبيق وحاول مرة أخرى.",
  origin: "تعذّر التحقق من مصدر الطلب.",
  challenge: "تعذّر التحقق. حاول مرة أخرى.",
  disabled: "الخدمة غير متاحة حاليًا. يمكنك قراءة الإجابات المحفوظة.",
  busy: "هناك إجابة قيد الإعداد. حاول بعد قليل.",
  storage: "الخدمة مشغولة الآن. حاول بعد قليل.",
  quota: "انتهت حصة الخدمة المشتركة اليوم. حاول غدًا.",
  rate: "الخدمة مشغولة الآن. حاول بعد قليل.",
  server: "الخدمة مشغولة الآن. حاول بعد قليل.",
  timeout: "الخدمة مشغولة الآن. حاول بعد قليل.",
  empty: "لم تصل إجابة هذه المرة. حاول بعد قليل.",
  auth: "الخدمة غير متاحة حاليًا.",
  unavailable: "الخدمة غير متاحة حاليًا.",
  network:
    "تعذّر الاتصال بخدمة الذكاء الاصطناعي. تحقق من الاتصال وحاول مرة أخرى.",
  refused: "تعذّر الرد على هذا السؤال.",
  aborted: "أُوقفت الإجابة.",
  stopped: "أُوقفت الإجابة.",
  cap: "وصلت للحد اليومي للإجابات على هذا الجهاز. حاول غدًا.",
  attempts: "تعذّرت محاولات كثيرة اليوم على هذا الجهاز. حاول غدًا.",
};

export default function AiPanel({
  id,
  passage,
  verse,
}: {
  id: string;
  passage: Passage;
  verse: Verse;
}) {
  const storage = useMemo(browserStorage, []);
  const [on, setOn] = useState(() => !isTurnedOff(storage));
  const [details, setDetails] = useState(false);
  const [view, setView] = useState<View>({ s: "idle" });
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [quota, setQuota] = useState<AiStatus>();
  const challengeRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const [, setTick] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const runs = useRef(0);
  const answerRef = useRef<HTMLDivElement>(null);
  // Focus targets for when the focused control disappears (see below).
  const root = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const lastChip = useRef<ChipId | null>(null);
  const chipButtons = useRef<Partial<Record<ChipId, HTMLButtonElement | null>>>(
    {},
  );
  const askButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const anotherButton = useRef<HTMLButtonElement>(null);
  const reportLink = useRef<HTMLAnchorElement>(null);
  const turnOnButton = useRef<HTMLButtonElement>(null);
  const busy = view.s === "loading" || view.s === "streaming";

  useEffect(() => {
    if (!on) return;
    const control = new AbortController();
    void aiStatus(control.signal)
      .then(setQuota)
      .catch(() => {});
    return () => control.abort();
  }, [on]);

  // Closing the sheet, or another verse or day, ends a request in flight.
  useEffect(() => () => controller.current?.abort("unmount"), []);

  // Re-enable «إعادة المحاولة» and «إجابة أخرى» when a cooldown ends.
  const cooling = !busy && view.s !== "idle" && guards.remaining() > 0;
  useEffect(() => {
    if (!cooling) return;
    const timer = setTimeout(
      () => setTick((n) => n + 1),
      guards.remaining() + 50,
    );
    return () => clearTimeout(timer);
  }, [cooling, view]);

  // A control that unmounts while focused («إيقاف» when the answer ends, a
  // button replaced by its result) would drop focus to <body> inside the modal
  // sheet. Move it to the control that took its place instead.
  useLayoutEffect(() => {
    const lost = lastFocus.current;
    if (!lost || lost.isConnected) return;
    lastFocus.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && !active.contains(root.current))
      return;
    const chip = view.s === "idle" ? lastChip.current : view.chip;
    const target = !on
      ? turnOnButton.current
      : (stopButton.current ??
        retryButton.current ??
        anotherButton.current ??
        reportLink.current ??
        (chip === "ask"
          ? askButton.current
          : chip
            ? chipButtons.current[chip]
            : null) ??
        chipButtons.current[CHIPS[0].id]);
    target?.focus({ preventScroll: true });
  });

  async function run(
    chip: ChipId,
    options: { fresh?: boolean; question?: string } = {},
  ) {
    if (controller.current) return;
    const text = chip === "ask" ? cleanQuestion(options.question ?? "") : "";
    if (chip === "ask") {
      if (text.length < QUESTION_MIN) return;
      setAsked(text);
    }
    const n = ++runs.current;
    lastChip.current = chip;
    const started = startAnswer(
      {
        chip,
        id,
        challengeElement: challengeRef.current ?? undefined,
        cacheRevision: quota?.available ? quota.cacheRevision : undefined,
        question: text,
        fresh: options.fresh,
        n,
      },
      { storage, guards, date: today() },
      {
        view: setView,
        status: setStatus,
        quota: setQuota,
        answered() {
          requestAnimationFrame(() => {
            if (answerRef.current) reveal(answerRef.current);
          });
        },
      },
    );
    if (!started) return;
    controller.current = started.controller;
    await started.done;
    if (controller.current === started.controller) controller.current = null;
  }

  function submitQuestion(event: FormEvent) {
    event.preventDefault();
    const text = cleanQuestion(question);
    if (text.length >= QUESTION_MIN && !busy)
      void run("ask", { fresh: true, question: text });
  }

  const chip = view.s === "idle" ? undefined : view.chip;
  const text =
    view.s === "streaming" || view.s === "done"
      ? view.text
      : view.s === "error"
        ? view.partial
        : undefined;
  const model =
    view.s === "streaming" || view.s === "done" || view.s === "error"
      ? view.model
      : undefined;
  const questionText = cleanQuestion(question);
  const reference = `${passage.book} ${passage.chapter}:${verse.number}`;
  const asking =
    chip === "ask" ? `سؤال: ${asked}` : CHIPS.find((c) => c.id === chip)?.label;
  const report =
    text && !busy
      ? reportMailto({ email: APP_INFO.email, reference, asking, model, text })
      : undefined;
  // A request the guards would refuse: offer no button for it (it would only
  // replace the answer with an error), or a disabled one during a cooldown.
  const blocked =
    busy || view.s === "idle" ? undefined : guards.refusal(storage, today());
  const final =
    (blocked !== undefined && blocked !== "rate") ||
    !!(
      quota &&
      Date.now() < quota.resets.device &&
      (quota.usage.answers >= quota.limits.answers ||
        quota.usage.attempts >= quota.limits.attempts)
    );
  const waiting = blocked === "rate";

  return (
    <div
      className="ai"
      ref={root}
      onFocus={(event) => {
        lastFocus.current = event.target;
      }}
      onBlur={(event) => {
        // Focus leaving the card (or the page) was the reader's choice.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          lastFocus.current = null;
      }}
    >
      {!on ? (
        <>
          <p className="ai-off">الميزة متوقفة على هذا الجهاز.</p>
          <button
            ref={turnOnButton}
            type="button"
            className="primary"
            onClick={() => {
              turnOn(storage);
              setOn(true);
              // Safari does not focus clicked buttons, so move focus explicitly.
              requestAnimationFrame(() =>
                chipButtons.current[CHIPS[0].id]?.focus(),
              );
            }}
          >
            تشغيل الميزة
          </button>
        </>
      ) : (
        <>
          <div className="ai-chips" role="group" aria-label="اختر نوع الشرح">
            {CHIPS.map((c) => (
              <button
                key={c.id}
                ref={(element) => {
                  chipButtons.current[c.id] = element;
                }}
                type="button"
                className="ai-chip"
                aria-pressed={chip === c.id}
                aria-disabled={busy || undefined}
                onClick={() => !busy && void run(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          {view.s !== "idle" && (
            <div className="ai-answer" ref={answerRef} aria-busy={busy}>
              {view.s === "loading" && (
                <div className="ai-progress">
                  <p className="ai-progress-line">
                    <span className="ai-orb">
                      <AiSpark size={22} />
                    </span>
                    <span className="ai-progress-text">
                      {view.thinking ? "النموذج يفكّر…" : "جارٍ إعداد الإجابة…"}
                    </span>
                  </p>
                  <div className="ai-shimmer" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
              {text && <AiAnswer blocks={parseAnswer(text)} />}
              {view.s === "error" && (
                <div className="ai-error" role="alert" key={view.n}>
                  <p>
                    {view.partial && view.problem !== "stopped"
                      ? "انقطعت الإجابة قبل اكتمالها."
                      : MESSAGES[view.problem]}
                  </p>
                  {(view.partial || RETRYABLE.has(view.problem)) && !final && (
                    <button
                      ref={retryButton}
                      type="button"
                      className="quiet-button"
                      aria-disabled={waiting || undefined}
                      onClick={() =>
                        !waiting &&
                        void run(view.chip, { fresh: true, question: asked })
                      }
                    >
                      <RefreshCw size={17} aria-hidden="true" />
                      إعادة المحاولة
                    </button>
                  )}
                </div>
              )}
              {busy && (
                <button
                  ref={stopButton}
                  type="button"
                  className="text-button"
                  onClick={() => controller.current?.abort("stop")}
                >
                  إيقاف
                </button>
              )}
              {text && !busy && (
                <div className="ai-footer">
                  <p>
                    إجابة مولَّدة بالذكاء الاصطناعي، قد تحتوي أخطاء ·{" "}
                    <bdi dir="ltr">{modelLabel(model)}</bdi>
                    {view.s === "done" &&
                      view.truncated &&
                      " (اختُصرت الإجابة لطولها)"}
                  </p>
                  <div className="ai-actions">
                    {view.s === "done" && !final && (
                      <button
                        ref={anotherButton}
                        type="button"
                        className="text-button"
                        aria-disabled={waiting || undefined}
                        onClick={() =>
                          !waiting &&
                          void run(view.chip, { fresh: true, question: asked })
                        }
                      >
                        إجابة أخرى
                      </button>
                    )}
                    {report && (
                      <a ref={reportLink} className="text-button" href={report}>
                        الإبلاغ عن خطأ
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div ref={challengeRef} className="ai-challenge" />
          <form className="ai-ask" onSubmit={submitQuestion}>
            <label htmlFor={`${id}-question`}>اكتب سؤالك عن هذه الآية</label>
            <div className="ai-ask-row">
              <input
                id={`${id}-question`}
                type="text"
                dir="auto"
                maxLength={QUESTION_MAX}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                enterKeyHint="send"
                autoComplete="off"
              />
              <button
                ref={askButton}
                type="submit"
                className="quiet-button"
                aria-disabled={
                  busy || questionText.length < QUESTION_MIN || undefined
                }
              >
                اسأل
              </button>
            </div>
          </form>

          <button
            type="button"
            className="ai-details-toggle"
            aria-expanded={details}
            aria-controls={`${id}-ai-details`}
            onClick={() => setDetails((open) => !open)}
          >
            <Info size={13} aria-hidden="true" />
            <span>التفاصيل والإعدادات</span>
          </button>
          <div id={`${id}-ai-details`} className="ai-details" hidden={!details}>
            <p>لا تكتب معلومات شخصية.</p>
            <p>
              يُرسَل نص الآية وسياقها إلى خدمة ذكاء اصطناعي خارجية، دون اسمك أو
              تقدّمك. المتبقي على هذا الجهاز اليوم:{" "}
              {quota
                ? `${ar(Math.max(0, quota.limits.answers - quota.usage.answers))} من ${ar(quota.limits.answers)}`
                : "جارٍ التحقق من الخدمة"}
              .
            </p>
            <p>
              تمرّ الآية وسياقها (وسؤالك إن كتبته) عبر خدمة{" "}
              <bdi>Cloudflare</bdi> للتحقق من الطلب وحساب الحصة، ثم عبر{" "}
              <bdi>OpenRouter</bdi> إلى مزوّد النموذج (Google أو غيره)، الذي قد
              يحتفظ بالنص ويستخدمه لتحسين نماذجه وقد يطّلع عليه مراجعون. تُحفظ
              الشروح الجاهزة المكتملة في Cloudflare لمدة سبعة أيام ليستخدمها
              القراء الآخرون، دون الأسئلة المكتوبة. يُستخدم ملف تعريف ارتباط آمن
              لمدة ٣٠ يومًا لحساب الحصة. الإجابات آلية وقد تحتوي أخطاء.
            </p>
            <button
              type="button"
              className="text-button ai-forget"
              onClick={() => {
                controller.current?.abort("unmount");
                turnOff(storage);
                lastChip.current = null;
                setOn(false);
                setDetails(false);
                setView({ s: "idle" });
                setStatus("");
              }}
            >
              إيقاف الميزة ومسح بياناتها
            </button>
          </div>
        </>
      )}
      <p className="sr-only" role="status">
        {status}
      </p>
    </div>
  );
}
