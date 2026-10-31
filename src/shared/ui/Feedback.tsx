import { Component, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

export function Loading({ label = "جارٍ تحميل القراءة…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="loading-dot" />
      {label}
      <div className="skeleton" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
export function LoadError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="load-error" role="alert">
      <p>{message}</p>
      <button className="quiet-button" onClick={retry}>
        <RefreshCw size={17} />
        إعادة المحاولة
      </button>
    </div>
  );
}
export class ChunkBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="load-error" role="alert">
        <p>تعذر فتح هذا الجزء. أعد تحميل الصفحة للمحاولة من جديد.</p>
        <button className="quiet-button" onClick={() => location.reload()}>
          إعادة تحميل الصفحة
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
