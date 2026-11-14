import { Suspense, useState } from "react";
import { Check, ChevronLeft, RotateCcw } from "lucide-react";
import { Streak } from "../streak/lazy";
import "./CompletionBar.css";

export default function CompletionBar({
  done,
  doneLabel,
  plan,
  onComplete,
  nextLabel,
  onNext,
}: {
  done: boolean;
  /** A youth plan reading (plan milestones apply). */
  plan?: boolean;
  /** What was read, e.g. «تمت قراءة هذا اليوم». */
  doneLabel: string;
  onComplete: () => void;
  /** The next place's title, when there is one in this mode. */
  nextLabel?: string;
  onNext?: () => void;
}) {
  // Celebrate only a reading marked done here, not one opened already done.
  const [cheer, setCheer] = useState(false);
  return (
    <div className={`reading-completion ${done ? "is-complete" : ""}`}>
      {done && (
        <p className="completion-state">
          <Check size={18} aria-hidden="true" /> {doneLabel}
        </p>
      )}
      <div className="completion-actions">
        <button
          className={done ? "quiet-button" : "primary"}
          onClick={() => {
            setCheer(!done);
            onComplete();
          }}
        >
          {done ? (
            <RotateCcw size={18} aria-hidden="true" />
          ) : (
            <Check size={18} aria-hidden="true" />
          )}
          {done ? "تراجع" : "تمت القراءة"}
        </button>
        {onNext && nextLabel && (
          // Moving on never completes a reading; it is offered either way.
          <button
            className={`completion-next ${done ? "primary" : "text-button"}`}
            onClick={onNext}
          >
            <span>التالي: {nextLabel}</span>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      {done && (
        <Suspense fallback={null}>
          <Streak moment cheer={cheer} plan={plan} />
        </Suspense>
      )}
    </div>
  );
}
