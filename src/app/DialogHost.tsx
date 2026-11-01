import { Suspense, lazy, type RefObject } from "react";
import { Check, X } from "lucide-react";
import { ChunkBoundary, Loading } from "../shared/ui/Feedback";
import { useModalDialog } from "../shared/ui/useModalDialog";
import type { Modal } from "../features/profiles/dialogs";
const Dialogs = lazy(() => import("../features/profiles/dialogs"));

const DIALOG_NAMES: Record<Modal["kind"], string> = {
  join: "القراء على هذا الجهاز",
  settings: "إعدادات القارئ",
  invite: "مشاركة التطبيق",
};

/**
 * The reader dialogs (readers, settings, sharing), loaded on first use.
 * Escape closes natively; focus returns to the opener, or to the menu button
 * when the opener has gone (a closed sheet's control).
 */
export default function DialogHost({
  modal,
  close,
  notice,
  setNotice,
  navigate,
  chooseReader,
  fallbackFocus,
}: {
  modal: Modal | null;
  close: () => void;
  notice: string;
  setNotice: (notice: string) => void;
  navigate: (view: "read") => void;
  chooseReader: (id: string | null) => void;
  fallbackFocus: RefObject<HTMLElement | null>;
}) {
  const { dialog, dialogProps } = useModalDialog({
    open: modal !== null,
    onClose: close,
    cancel: "native",
    syncNativeClose: false,
    fallbackFocus,
  });
  return (
    <dialog
      className="app-dialog"
      aria-label={DIALOG_NAMES[modal?.kind ?? "join"]}
      ref={dialog}
      {...dialogProps}
    >
      <div className="dialog-content">
        <button
          className="icon-button dialog-close"
          aria-label="إغلاق"
          onClick={close}
        >
          <X size={22} />
        </button>
        {modal && (
          <ChunkBoundary key={modal.kind}>
            <Suspense fallback={<Loading label="جارٍ فتح النافذة…" />}>
              <Dialogs
                modal={modal}
                close={close}
                navigate={navigate}
                setNotice={setNotice}
                chooseReader={chooseReader}
              />
            </Suspense>
          </ChunkBoundary>
        )}
      </div>
      {notice && modal && (
        <div className="dialog-notice" role="status">
          <Check size={19} />
          <span>{notice}</span>
        </div>
      )}
    </dialog>
  );
}
