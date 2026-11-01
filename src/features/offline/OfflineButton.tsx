import { CircleCheck, Download, Square, TriangleAlert } from "lucide-react";
import { ar } from "../../shared/lib/format";
import { allSaved, busy, PACK_ORDER, type Downloads } from "./downloadQueue";
import type { Pack } from "./packs";
import {
  saveOffline,
  stopSaving,
  useOfflineDownloads,
} from "./offlineDownloads";
import "./OfflineButton.css";

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const STEP: Record<Pack, string> = {
  text: "الكتاب المقدس",
  study: "الملاحظات",
};
const EVERYTHING = "الكتاب المقدس وملاحظات الدراسة";

/** The pack saving now (or next) and how much of it is kept, 0 to 1. */
function step(downloads: Downloads) {
  const pack = downloads.active ?? downloads.queued[0] ?? "text";
  const status = downloads.packs[pack];
  const share =
    (status.kind === "saving" || status.kind === "ready") && status.total
      ? status.saved / status.total
      : 0;
  return { pack, share };
}

/**
 * The menu header's download: everything for reading offline in one tap,
 * Scripture text first and then study notes. Its label says what it does
 * and, while saving, which part and how far, with the same progress as a
 * ring. Saving goes on after the menu closes; tapping again stops it.
 */
export default function OfflineButton() {
  const downloads = useOfflineDownloads();
  const saving = busy(downloads);
  const done = allSaved(downloads);
  const failed =
    !saving &&
    !done &&
    PACK_ORDER.some((pack) => downloads.packs[pack].kind === "error");
  const { pack, share } = step(downloads);
  // Every accessible name begins with, or contains, the visible label.
  const percent = `${ar(Math.floor(share * 100))}٪`;
  const [text, label] = done
    ? ["محفوظ", `محفوظ: ${EVERYTHING} على هذا الجهاز`]
    : saving
      ? [
          // «المقدس» gives way on the narrowest phones.
          pack === "text" ? (
            <>
              الكتاب<span className="offline-wide"> المقدس</span> {percent}
            </>
          ) : (
            `${STEP[pack]} ${percent}`
          ),
          `إيقاف تنزيل ${STEP[pack]} ${percent}`,
        ]
      : failed
        ? ["أعد المحاولة", `أعد المحاولة: تنزيل ${EVERYTHING}`]
        : ["تنزيل", `تنزيل ${EVERYTHING} للقراءة دون اتصال`];
  return (
    <button
      type="button"
      className="offline-button"
      aria-label={label}
      title={label}
      aria-disabled={done || undefined}
      data-state={
        done ? "done" : saving ? "saving" : failed ? "failed" : undefined
      }
      onClick={() => {
        if (done) return;
        if (saving) stopSaving();
        else void saveOffline();
      }}
    >
      <span className="offline-pill">
        {done ? (
          <CircleCheck size={17} aria-hidden="true" />
        ) : saving ? (
          <span className="offline-ring" aria-hidden="true">
            <svg
              className="offline-ring-svg"
              viewBox="0 0 36 36"
              width="20"
              height="20"
            >
              <circle
                cx="18"
                cy="18"
                r={RADIUS}
                className="offline-ring-track"
              />
              <circle
                cx="18"
                cy="18"
                r={RADIUS}
                className="offline-ring-value"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - share)}
              />
            </svg>
            <Square size={7} fill="currentColor" />
          </span>
        ) : failed ? (
          <TriangleAlert size={17} aria-hidden="true" />
        ) : (
          <Download size={17} aria-hidden="true" />
        )}
        <span className="offline-pill-text">{text}</span>
      </span>
    </button>
  );
}
