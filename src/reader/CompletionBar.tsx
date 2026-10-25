import { Suspense, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { Streak } from "../streak/lazy";
import "./CompletionBar.css";

export default function CompletionBar({
  done,
  doneLabel,
  plan,
  onComplete,
}: {
  done: boolean;
  /** A youth plan reading (plan milestones apply). */
  plan?: boolean;
  /** What was read, e.g. «تمت قراءة هذا اليوم». */
  doneLabel: string;
  onComplete: () => void;
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
      {done && (
        <Suspense fallback={null}>
          <Streak moment cheer={cheer} plan={plan} />
        </Suspense>
      )}
    </div>
  );
}
