import type { ReactNode } from "react";
import { useBackupRestore } from "../useBackupRestore";
import type { Actions } from ".";

export default function RestoreButton({
  close,
  navigate,
  setNotice,
  children,
}: Actions & { children: ReactNode }) {
  // The dialog closes at once and returns to the reading.
  const backup = useBackupRestore(() => {
    close();
    navigate("read");
    setNotice("تمت الاستعادة كقارئ منفصل. لم تُحذف أي قراءة سابقة.");
  });
  return (
    <>
      <button className="setting-row" onClick={backup.choose}>
        {children}
      </button>
      {backup.input}
    </>
  );
}
