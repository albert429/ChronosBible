import { CircleCheck, Download, Square } from "lucide-react";
import { ar } from "../../shared/lib/format";
import { allSaved, busy, overall } from "./downloadQueue";
import {
  saveOffline,
  stopSaving,
  useOfflineDownloads,
} from "./offlineDownloads";
import "./OfflineButton.css";

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The menu header's download: everything for reading offline in one tap,
 * Scripture text first and then study notes, with its progress as a ring.
 * Saving goes on after the menu closes; tapping again stops it.
 */
export default function OfflineButton() {
  const downloads = useOfflineDownloads();
  const saving = busy(downloads);
  const done = allSaved(downloads);
  const share = overall(downloads) ?? 0;
  const percent = ar(Math.floor(share * 100));
  const label = done
    ? "الكتاب المقدس وملاحظات الدراسة محفوظة على هذا الجهاز"
    : saving
      ? `إيقاف التنزيل، تم ${percent}٪`
      : "تنزيل الكتاب المقدس وملاحظات الدراسة للقراءة دون اتصال";
  return (
    <button
      type="button"
      className="icon-button offline-button"
      aria-label={label}
      title={label}
      aria-disabled={done || undefined}
      data-state={done ? "done" : saving ? "saving" : undefined}
      onClick={() => {
        if (done) return;
        if (saving) stopSaving();
        else void saveOffline();
      }}
    >
      {done ? (
        <CircleCheck size={20} aria-hidden="true" />
      ) : saving ? (
        <span className="offline-ring" aria-hidden="true">
          <svg
            className="offline-ring-svg"
            viewBox="0 0 36 36"
            width="32"
            height="32"
          >
            <circle cx="18" cy="18" r={RADIUS} className="offline-ring-track" />
            <circle
              cx="18"
              cy="18"
              r={RADIUS}
              className="offline-ring-value"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - share)}
            />
          </svg>
          <Square size={10} fill="currentColor" />
        </span>
      ) : (
        <Download size={20} aria-hidden="true" />
      )}
    </button>
  );
}
