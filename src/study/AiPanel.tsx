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
import {
  answerKey,
  browserStorage,
  readAnswer,
  recordAnswer,
  recordAttempt,
  saveAnswer,
  usage,
  turnOff,
  turnOn,
  isTurnedOff,
  type StorageLike,
} from "../ai/cache.ts";
import {
  cleanAnswer,
  clip,
  MAX_TEXT,
  modelLabel,
  parseAnswer,
  wellFormed,
} from "../ai/format.ts";
import {
  CHIPS,
  cleanQuestion,
  PROMPT_VERSION,
  QUESTION_MAX,
  QUESTION_MIN,
} from "../ai/chips.ts";
import {
  abortable,
  AiError,
  type AiErrorKind,
  type ChipId,
} from "../ai/types.ts";
import { APP_INFO } from "../appInfo";
import { ar, today } from "../lib/format";
import type { Passage, Verse } from "../plan/readings";
import AiAnswer from "./AiAnswer";
import AiSpark from "./AiSpark";
import { reveal } from "./Section";
import "../components/form.css";

type Problem = AiErrorKind | "cap" | "attempts" | "stopped";
type View =
  | { s: "idle" }
  | { s: "loading"; chip: ChipId; thinking: boolean }
  | { s: "streaming"; chip: ChipId; text: string; model?: string }
  | {
      s: "done";
      chip: ChipId;
      text: string;
      model?: string;
      truncated: boolean;
    }
  | {
      s: "error";
      chip: ChipId;
      problem: Problem;
      partial?: string;
      model?: string;
      /** The run that failed: a repeated, identical alert is announced again. */
      n: number;
    };

// Session-wide guards that protect the shared OpenRouter allowance.
let quotaReached = false;
let coolUntil = 0;
let failures = 0;

const MESSAGES: Record<Problem, string> = {
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
  cap: `وصلت للحد اليومي للإجابات على هذا الجهاز (${ar(__AI_DAILY_CAP__)}). حاول غدًا.`,
  attempts: "تعذّرت محاولات كثيرة اليوم على هذا الجهاز. حاول غدًا.",
};
const RETRYABLE = new Set<Problem>([
  "rate",
  "server",
  "timeout",
  "empty",
  "network",
  "stopped",
  "aborted",
]);

/** Why a new request would be refused right now, if it would be. */
function refusal(storage: StorageLike | null, date: string) {
  if (quotaReached) return "quota";
  const { n, a } = usage(storage, date);
  if (n >= __AI_DAILY_CAP__) return "cap";
  if (a >= __AI_ATTEMPT_CAP__) return "attempts";
  if (Date.now() < coolUntil) return "rate";
}

/** Session guards after a failure that left no answer text. */
function backOff(kind: Problem, retryAt?: number) {
  const now = Date.now();
  if (kind === "quota") quotaReached = true;
  else if (kind === "rate")
    // The service's reset time, bounded: the device clock may be wrong.
    coolUntil = now + Math.min(65000, Math.max(30000, (retryAt ?? 0) - now));
  else if (RETRYABLE.has(kind)) {
    failures += 1;
    coolUntil = now + (failures === 1 ? 5000 : 15000);
  }
}

const finished = (chip: ChipId) =>
  chip === "ask"
    ? "اكتملت الإجابة عن سؤالك"
    : `اكتملت الإجابة: ${CHIPS.find((c) => c.id === chip)?.label}`;

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
  const [used, setUsed] = useState(() => usage(storage, today()).n);
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

  // Closing the sheet, or another verse or day, ends a request in flight.
  useEffect(() => () => controller.current?.abort("unmount"), []);

  // Re-enable «إعادة المحاولة» and «إجابة أخرى» when a cooldown ends.
  const cooling = !busy && view.s !== "idle" && Date.now() < coolUntil;
  useEffect(() => {
    if (!cooling) return;
    const timer = setTimeout(
      () => setTick((n) => n + 1),
      Math.max(0, coolUntil - Date.now()) + 50,
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
    const key = chip === "ask" ? null : answerKey(id, chip, PROMPT_VERSION);
    if (key && !options.fresh) {
      const cached = readAnswer(storage, key);
      if (cached) {
        setView({ s: "done", chip, ...cached, truncated: !!cached.truncated });
        setStatus(finished(chip));
        return;
      }
    }
    const date = today();
    const refused = refusal(storage, date);
    if (refused) {
      setView({ s: "error", chip, problem: refused, n });
      return;
    }

    const current = new AbortController();
    controller.current = current;
    setView({ s: "loading", chip, thinking: false });
    setStatus("جارٍ إعداد الإجابة…");
    let raw = "";
    let model: string | undefined;
    let counted = false;
    let truncated = false;
    let frame = 0;
    const flush = () => {
      frame = 0;
      const shown = cleanAnswer(raw);
      if (shown) setView({ s: "streaming", chip, text: shown, model });
    };
    const finish = () => {
      const answer = clip(cleanAnswer(raw), MAX_TEXT);
      if (!answer) {
        backOff("empty");
        setView({ s: "error", chip, problem: "empty", n });
        setStatus("");
        return;
      }
      failures = 0;
      if (key)
        saveAnswer(
          storage,
          key,
          truncated
            ? { text: answer, model: model ?? "", truncated: true }
            : { text: answer, model: model ?? "" },
          PROMPT_VERSION,
        );
      setView({ s: "done", chip, text: answer, model, truncated });
      setStatus(finished(chip));
    };

    try {
      // Neither the chunk nor the study files may delay «إيقاف».
      const { ask } = await abortable(import("../ai/run.ts"), current.signal);
      const meta = await ask(
        {
          chip,
          id,
          material: { book: passage.book, passage, verse },
          question: text,
        },
        current.signal,
        {
          onText(delta) {
            raw += delta;
            const shown = cleanAnswer(raw);
            if (!shown) return;
            if (!counted) {
              // The shared allowance is spent and the reader got something.
              counted = true;
              setUsed(recordAnswer(storage, date).n);
              requestAnimationFrame(() => {
                if (answerRef.current) reveal(answerRef.current);
              });
            }
            if (shown.length > MAX_TEXT) {
              truncated = true;
              current.abort("truncated");
              return;
            }
            frame ||= requestAnimationFrame(flush);
          },
          onMeta(name) {
            model = name;
          },
          onActivity() {
            setView((v) => (v.s === "loading" ? { ...v, thinking: true } : v));
          },
        },
        () => recordAttempt(storage, date),
      );
      model = meta.model || model;
      truncated ||= meta.finish === "length";
      finish();
    } catch (error) {
      const reason = current.signal.reason;
      if (reason === "truncated") return finish();
      if (reason === "unmount") return;
      const failure = error instanceof AiError ? error : new AiError("network");
      model = failure.model ?? model;
      const partial = clip(cleanAnswer(raw), MAX_TEXT) || undefined;
      setStatus("");
      if (reason === "stop") {
        if (partial)
          setView({ s: "error", chip, problem: "stopped", partial, model, n });
        else {
          setView({ s: "idle" });
          setStatus("أُوقفت الإجابة.");
        }
        return;
      }
      if (partial) {
        setView({ s: "error", chip, problem: failure.kind, partial, model, n });
        return;
      }
      backOff(failure.kind, failure.retryAt);
      setView({ s: "error", chip, problem: failure.kind, n });
    } finally {
      cancelAnimationFrame(frame);
      if (controller.current === current) controller.current = null;
    }
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
      ? `mailto:${APP_INFO.email}?subject=${encodeURIComponent(
          "خطأ في إجابة الذكاء الاصطناعي",
        )}&body=${encodeURIComponent(
          wellFormed(
            [
              `المرجع: ${reference}`,
              `الطلب: ${asking ?? ""}`,
              `النموذج: ${modelLabel(model)}`,
              `إصدار الطلب: ${PROMPT_VERSION}`,
              "",
              clip(text, 1500),
            ].join("\n"),
          ),
        )}`
      : undefined;
  // A request the guards would refuse: offer no button for it (it would only
  // replace the answer with an error), or a disabled one during a cooldown.
  const blocked =
    busy || view.s === "idle" ? undefined : refusal(storage, today());
  const final = blocked !== undefined && blocked !== "rate";
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
              {ar(Math.max(0, __AI_DAILY_CAP__ - used))} من{" "}
              {ar(__AI_DAILY_CAP__)}.
            </p>
            <p>
              تمرّ الآية وسياقها (وسؤالك إن كتبته) عبر خدمة{" "}
              <bdi>OpenRouter</bdi>، التي ترى عنوان IP الخاص بك، ثم إلى مزوّد
              النموذج (Google أو غيره)، الذي قد يحتفظ بالنص ويستخدمه لتحسين
              نماذجه وقد يطّلع عليه مراجعون. الإجابات آلية وقد تحتوي أخطاء.
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
