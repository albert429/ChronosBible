import { useRef, type ChangeEvent, type ReactNode } from "react";
import { readBackupFile } from "../backupFile";
import { useProgress } from "../useProgress";
import type { Actions } from ".";

export default function RestoreButton({
  close,
  navigate,
  setNotice,
  children,
}: Actions & { children: ReactNode }) {
  const progress = useProgress();
  const input = useRef<HTMLInputElement>(null);
  async function restore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (progress.restore(await readBackupFile(file))) {
        close();
        navigate("read");
        setNotice("تمت الاستعادة كقارئ منفصل. لم تُحذف أي قراءة سابقة.");
      }
    } catch (err) {
      progress.fail(err);
    } finally {
      event.target.value = "";
    }
  }
  return (
    <>
      <button className="setting-row" onClick={() => input.current?.click()}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={restore}
        aria-label="ملف النسخة الاحتياطية"
      />
    </>
  );
}
