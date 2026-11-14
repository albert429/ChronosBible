import "./ai.css";
import { Info, RefreshCw } from "lucide-react";
import { modelLabel, parseAnswer } from "./format.ts";
import { CHIPS, QUESTION_MAX, QUESTION_MIN } from "./domain/chips.ts";
import { RETRYABLE, type Problem } from "./guards.ts";
import { ar } from "../../shared/lib/format";
import AiAnswer from "./AiAnswer";
import AiSpark from "./AiSpark";
import { useAiPanel, type AiPanelProps } from "./useAiPanel.ts";
import { useAiFocus } from "./useAiFocus.ts";
import "../../shared/ui/form.css";

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

export default function AiPanel(props: AiPanelProps) {
  const { id } = props;
  const {
    on,
    details,
    setDetails,
    view,
    question,
    setQuestion,
    asked,
    quota,
    challengeRef,
    status,
    answerRef,
    lastChip,
    busy,
    run,
    submitQuestion,
    chip,
    text,
    model,
    questionText,
    report,
    final,
    waiting,
    enable,
    disable,
    stop,
  } = useAiPanel(props);
  const {
    root,
    lastFocus,
    chipButtons,
    askButton,
    stopButton,
    retryButton,
    anotherButton,
    reportLink,
    turnOnButton,
  } = useAiFocus(on, view, lastChip);
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
              enable();
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
                  onClick={stop}
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
              onClick={disable}
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
