import { today } from "../lib/format";
import {
  MAX_BACKUP_BYTES,
  exportBackup,
  loadProgress,
  type Reader,
  type ReaderProfile,
} from "./progress";

/** Downloads a v2 backup with the reader's latest stored places. */
export function downloadBackup(reader: Reader | ReaderProfile) {
  let latest: Reader | ReaderProfile = reader;
  try {
    latest =
      loadProgress(localStorage).profiles.find((p) => p.id === reader.id) ??
      reader;
  } catch {
    /* the reader as shown */
  }
  const url = URL.createObjectURL(
    new Blob([exportBackup(latest)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `nt-reading-backup-${today()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readBackupFile(file: File) {
  if (file.size > MAX_BACKUP_BYTES)
    throw Error("اختر ملف نسخة احتياطية صغيرًا بصيغة JSON.");
  return file.text();
}
