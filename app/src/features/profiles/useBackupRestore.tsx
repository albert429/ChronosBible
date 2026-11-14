import { useRef, type ChangeEvent } from "react";
import { readBackupFile } from "./backupFile";
import { useProgress } from "./useProgress";

/**
 * Restoring a backup file as a separate reader. `choose` opens the file
 * picker rendered by `input`; `restored` runs once the backup is saved,
 * and a failure is reported through the progress error.
 */
export function useBackupRestore(restored: () => void) {
  const progress = useProgress();
  const picker = useRef<HTMLInputElement>(null);
  async function restore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (progress.restore(await readBackupFile(file))) restored();
    } catch (err) {
      progress.fail(err);
    } finally {
      event.target.value = "";
    }
  }
  return {
    choose: () => picker.current?.click(),
    input: (
      <input
        ref={picker}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={restore}
        aria-label="ملف النسخة الاحتياطية"
      />
    ),
  };
}
