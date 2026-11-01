import { useState } from "react";
import type { Modal } from "../features/profiles/dialogs";
import type { ReadingSession } from "./useReadingSession";

/**
 * Which reader dialog is open. Opening one clears a stale storage error;
 * choosing no reader leads on to adding one.
 */
export function useProfileDialogs(session: ReadingSession) {
  const [modal, setModal] = useState<Modal | null>(null);
  function close() {
    setModal(null);
  }
  return {
    modal,
    open(next: Modal) {
      session.progress.clearError();
      setModal(next);
    },
    close,
    chooseReader(id: string | null) {
      if (!session.chooseReader(id)) return;
      if (id === null) setModal({ kind: "join" });
      else close();
    },
  };
}
