import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ar } from "../../shared/lib/format";
import { reveal } from "../../shared/ui/reveal";

/**
 * A collapsed card (heading button + panel). Its content mounts, and loads its
 * data, on first open, then stays mounted while the sheet is open.
 */
export default function Section({
  title,
  hint,
  icon,
  count,
  children,
}: {
  title: string;
  hint: string;
  icon: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const element = card.current;
    if (!open || !element) return;
    // Content may still be loading, so follow its growth briefly.
    const frame = requestAnimationFrame(() => reveal(element));
    const observer = new ResizeObserver(() => reveal(element));
    observer.observe(element);
    const stop = setTimeout(() => observer.disconnect(), 1200);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(stop);
      observer.disconnect();
    };
  }, [open]);

  return (
    <div className="study-section" data-open={open || undefined} ref={card}>
      <h3>
        <button
          type="button"
          className="study-section-toggle"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          aria-labelledby={
            count === undefined ? `${id}-title` : `${id}-title ${id}-count`
          }
          aria-describedby={`${id}-hint`}
          onClick={() => {
            setMounted(true);
            setOpen((value) => !value);
          }}
        >
          <span className="study-section-icon" aria-hidden="true">
            {icon}
          </span>
          <span className="study-section-text">
            <span id={`${id}-title`} className="study-section-title">
              {title}
            </span>
            <span id={`${id}-hint`} className="study-section-hint">
              {hint}
            </span>
          </span>
          {count !== undefined && (
            <span id={`${id}-count`} className="study-count">
              {ar(count)}
            </span>
          )}
          <ChevronDown className="study-chevron" size={18} aria-hidden="true" />
        </button>
      </h3>
      <div id={`${id}-panel`} className="study-section-body" hidden={!open}>
        {mounted && children}
      </div>
    </div>
  );
}
