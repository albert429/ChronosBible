/**
 * Backup files: version 2 (every track's completion and place for one
 * reader) is written; version 1 (youth plan days only) and version 2 are
 * read. Pure text transformations; importing adds the reader in storage.
 */
import {
  INVALID,
  emptyCompletion,
  onlyKeys,
  parseBackupReader,
  parseCompletion,
  record,
  validateReader,
  type BackupReader,
  type Reader,
  type ReaderProfile,
} from "./state.ts";

export const MAX_BACKUP_BYTES = 262144;

/** A version 2 backup: every track's completion and place for one reader. */
export function exportBackup(reader: Reader | ReaderProfile) {
  const completion =
    "completion" in reader
      ? parseCompletion(reader.completion)
      : emptyCompletion(reader.completed);
  const body = parseBackupReader({
    name: reader.name,
    startDate: reader.startDate,
    ...("track" in reader
      ? { track: reader.track, places: reader.places }
      : { track: "plan", places: {} }),
    completion,
    readOn: (reader as ReaderProfile).readOn,
  });
  return JSON.stringify({ version: 2, reader: body }, null, 2);
}
/** The reader in a v1 or v2 backup file; throws a message for the reader. */
export function parseBackup(text: string): BackupReader {
  if (text.length > MAX_BACKUP_BYTES)
    throw Error("ملف النسخة الاحتياطية كبير جدًا.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error("اختر ملف نسخة احتياطية بصيغة JSON.");
  }
  if (record(data) && data.version === 1) {
    const r = validateReader(data.reader);
    return {
      name: r.name,
      startDate: r.startDate,
      track: "plan",
      places: {},
      completion: emptyCompletion(r.completed),
    };
  }
  if (!record(data) || data.version !== 2)
    throw Error("نسخة احتياطية غير مدعومة.");
  if (
    !onlyKeys(data, ["version", "reader"]) ||
    !record(data.reader) ||
    !onlyKeys(data.reader, [
      "name",
      "startDate",
      "track",
      "places",
      "completion",
      "readOn",
    ])
  )
    throw Error(INVALID);
  return parseBackupReader(data.reader);
}
