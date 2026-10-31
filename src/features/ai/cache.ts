// On-device AI data: cached answers, daily usage and the off switch. Every
// access is guarded (private mode, quota errors, tampered values) and these
// keys are separate from reading progress and never part of backups.

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const CACHE_KEY = "nt-ai-cache-v1";
export const USAGE_KEY = "nt-ai-usage-v1";
/** Set when the reader turns the feature off on this device. */
export const OFF_KEY = "nt-ai-off-v1";
/** Left by builds that asked for consent first; cleared with the other data. */
const LEGACY_CONSENT_KEY = "nt-ai-consent-v1";
export const MAX_ENTRIES = 60;
export const MAX_TOTAL_CHARS = 200_000;
const MAX_ANSWER = 6000;

export type CachedAnswer = { text: string; model: string; truncated?: true };
export type Usage = { date: string; n: number; a: number };
type Entry = [key: string, text: string, model: string, truncated?: 1];

export function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const answerKey = (id: string, chip: string, version: number) =>
  `${id}|${chip}|${version}`;

const validEntry = (e: unknown): e is Entry =>
  Array.isArray(e) &&
  typeof e[0] === "string" &&
  e[0].length <= 64 &&
  typeof e[1] === "string" &&
  e[1].length <= MAX_ANSWER &&
  typeof e[2] === "string" &&
  e[2].length <= 100 &&
  (e[3] === undefined || e[3] === 1);

function readEntries(storage: StorageLike | null): Entry[] {
  try {
    const data = JSON.parse(storage?.getItem(CACHE_KEY) ?? "null");
    return data?.v === 1 && Array.isArray(data.e)
      ? data.e.filter(validEntry)
      : [];
  } catch {
    return [];
  }
}

function writeEntries(storage: StorageLike | null, entries: Entry[]) {
  if (!storage) return;
  const save = (list: Entry[]) =>
    storage.setItem(CACHE_KEY, JSON.stringify({ v: 1, e: list }));
  try {
    save(entries);
  } catch {
    try {
      save(entries.slice(Math.floor(entries.length / 2)));
    } catch {
      // Storage full or blocked: answers simply are not cached.
    }
  }
}

export function readAnswer(
  storage: StorageLike | null,
  key: string,
): CachedAnswer | undefined {
  const entries = readEntries(storage);
  const index = entries.findIndex((e) => e[0] === key);
  if (index < 0) return undefined;
  const [entry] = entries.splice(index, 1);
  entries.push(entry); // most recently used last
  writeEntries(storage, entries);
  return entry[3]
    ? { text: entry[1], model: entry[2], truncated: true }
    : { text: entry[1], model: entry[2] };
}

export function saveAnswer(
  storage: StorageLike | null,
  key: string,
  answer: CachedAnswer,
  version: number,
) {
  const entry: Entry = [
    key,
    answer.text.slice(0, MAX_ANSWER),
    answer.model.slice(0, 100),
  ];
  if (answer.truncated) entry.push(1);
  if (!validEntry(entry)) return;
  const entries = readEntries(storage).filter(
    (e) => e[0] !== key && e[0].endsWith(`|${version}`),
  );
  entries.push(entry);
  let total = entries.reduce((sum, e) => sum + e[1].length, 0);
  while (entries.length > MAX_ENTRIES || total > MAX_TOTAL_CHARS) {
    total -= entries.shift()![1].length;
  }
  writeEntries(storage, entries);
}

// When storage is missing or refuses writes, counts and the off switch still
// hold for this page session. Keyed by storage object, so each is separate.
const NO_STORAGE = {};
const sessionUsage = new WeakMap<object, Usage>();
const sessionOff = new WeakSet<object>();
const slot = (storage: StorageLike | null) => storage ?? NO_STORAGE;

function storedUsage(storage: StorageLike | null, date: string): Usage {
  try {
    const data = JSON.parse(storage?.getItem(USAGE_KEY) ?? "null");
    if (
      data?.date === date &&
      Number.isInteger(data.n) &&
      Number.isInteger(data.a) &&
      data.n >= 0 &&
      data.a >= 0
    )
      return { date, n: data.n, a: data.a };
  } catch {
    // fall through
  }
  return { date, n: 0, a: 0 };
}

/** Today's answers (n) and requests (a) on this device; another date is 0. */
export function usage(storage: StorageLike | null, date: string): Usage {
  const stored = storedUsage(storage, date);
  const session = sessionUsage.get(slot(storage));
  if (session?.date !== date) return stored;
  return {
    date,
    n: Math.max(stored.n, session.n),
    a: Math.max(stored.a, session.a),
  };
}

function bump(storage: StorageLike | null, date: string, field: "n" | "a") {
  const next = usage(storage, date);
  next[field] += 1;
  sessionUsage.set(slot(storage), { ...next });
  try {
    storage?.setItem(USAGE_KEY, JSON.stringify(next));
  } catch {
    // Not persisted; the session count still applies until the page reloads.
  }
  return next;
}
export const recordAttempt = (storage: StorageLike | null, date: string) =>
  bump(storage, date, "a");
export const recordAnswer = (storage: StorageLike | null, date: string) =>
  bump(storage, date, "n");

export function isTurnedOff(storage: StorageLike | null) {
  if (sessionOff.has(slot(storage))) return true;
  try {
    return storage?.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

/** Turn the feature off and delete cached answers. Usage counts stay (they
 * hold no content), so turning it back on does not reset the daily caps. */
export function turnOff(storage: StorageLike | null) {
  try {
    storage?.removeItem(CACHE_KEY);
    storage?.removeItem(LEGACY_CONSENT_KEY);
  } catch {
    // Nothing to clear.
  }
  try {
    if (!storage) throw new Error("no storage");
    storage.setItem(OFF_KEY, "1");
  } catch {
    // Not saved: the feature stays off until the page reloads.
    sessionOff.add(slot(storage));
  }
}

export function turnOn(storage: StorageLike | null) {
  sessionOff.delete(slot(storage));
  try {
    storage?.removeItem(OFF_KEY);
  } catch {
    // Already on.
  }
}
