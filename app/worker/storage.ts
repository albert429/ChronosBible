import { AiError, type AiStatus } from "../src/features/ai/domain/types.ts";
import {
  CACHE_ENTRIES,
  CACHE_TTL,
  DEVICE_LIMITS,
  LIMITS,
  OVERALL_MS,
} from "./env.ts";

type Counter = { n: number; a: number };
type Lease = {
  id: string;
  device: string;
  day: string;
  counted: number;
  expires: number;
};
export function dayAt(now: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
/** Find the actual next midnight, including Cairo's 23/25-hour DST days. */
export function resetAt(now: number, timeZone: string) {
  const day = dayAt(now, timeZone);
  let low = Math.floor(now / 1000),
    high = low + 27 * 3600;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (dayAt(middle * 1000, timeZone) === day) low = middle;
    else high = middle;
  }
  return high * 1000;
}

/** All checks and reservations are synchronous SQLite transactions. No network awaits. */
export class Ledger {
  private storage: DurableObjectStorage;
  private limits: (typeof LIMITS)[keyof typeof LIMITS];
  constructor(
    storage: DurableObjectStorage,
    environment: "dev" | "production",
  ) {
    this.storage = storage;
    this.limits = LIMITS[environment];
    storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, a INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS attempts_at ON attempts(at);
      CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, device TEXT NOT NULL UNIQUE, day TEXT NOT NULL, counted INTEGER NOT NULL DEFAULT 0, cache_key TEXT UNIQUE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bursts (ip TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS bursts_ip_at ON bursts(ip, at);
      CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS answers (key TEXT PRIMARY KEY, text TEXT NOT NULL, model TEXT NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS answers_expires ON answers(expires);
    `);
  }
  private rows<T extends Record<string, SqlStorageValue>>(
    sql: string,
    ...args: SqlStorageValue[]
  ) {
    return this.storage.sql.exec<T>(sql, ...args).toArray();
  }
  private counter(key: string): Counter {
    return (
      this.rows<Counter>("SELECT n,a FROM counters WHERE key=?", key)[0] ?? {
        n: 0,
        a: 0,
      }
    );
  }
  private bump(key: string, n: number, a: number, now: number) {
    this.storage.sql.exec(
      `INSERT INTO counters(key,n,a,updated) VALUES(?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET n=n+excluded.n,a=a+excluded.a,updated=excluded.updated`,
      key,
      n,
      a,
      now,
    );
  }
  cleanup(now: number) {
    this.storage.transactionSync(() => {
      this.storage.sql.exec("DELETE FROM leases WHERE expires<=?", now);
      this.storage.sql.exec("DELETE FROM tokens WHERE expires<=?", now);
      this.storage.sql.exec("DELETE FROM attempts WHERE at<=?", now - 60000);
      this.storage.sql.exec("DELETE FROM bursts WHERE at<=?", now - 60000);
      this.storage.sql.exec(
        "DELETE FROM counters WHERE updated<=?",
        now - 48 * 3600000,
      );
      this.storage.sql.exec("DELETE FROM answers WHERE expires<=?", now);
    });
  }
  burst(ip: string, now: number) {
    this.storage.transactionSync(() => {
      this.cleanup(now);
      const hits = this.rows<{ at: number }>(
        "SELECT at FROM bursts WHERE ip=? AND at>? ORDER BY at",
        ip,
        now - 60000,
      );
      if (hits.length >= 20)
        throw new AiError("rate", false, { retryAt: hits[0].at + 60000 });
      this.storage.sql.exec("INSERT INTO bursts VALUES(?,?)", ip, now);
    });
  }
  token(hash: string, now: number) {
    this.storage.transactionSync(() => {
      if (
        this.rows(
          "SELECT hash FROM tokens WHERE hash=? AND expires>?",
          hash,
          now,
        ).length
      )
        throw new AiError("challenge");
      this.storage.sql.exec(
        "INSERT OR REPLACE INTO tokens VALUES(?,?)",
        hash,
        now + 300000,
      );
    });
  }
  status(
    device: string,
    now: number,
    cacheRevision: string,
    available: boolean,
  ): AiStatus {
    const usage = this.counter(`d:${device}:${dayAt(now, "Africa/Cairo")}`);
    return {
      available,
      cacheRevision,
      limits: DEVICE_LIMITS,
      usage: { answers: usage.n, attempts: usage.a },
      resets: {
        device: resetAt(now, "Africa/Cairo"),
        provider: resetAt(now, "UTC"),
      },
    };
  }
  reserve(id: string, device: string, cacheKey: string | null, now: number) {
    this.storage.transactionSync(() => {
      this.cleanup(now);
      const leases = this.rows<Lease>("SELECT * FROM leases");
      if (
        leases.some((l) => l.device === device) ||
        leases.length >= this.limits.concurrent ||
        (cacheKey &&
          this.rows("SELECT id FROM leases WHERE cache_key=?", cacheKey).length)
      )
        throw new AiError("busy", false, { retryAt: now + 3000 });
      const day = dayAt(now, "Africa/Cairo");
      const counts = this.counter(`d:${device}:${day}`);
      if (counts.n >= DEVICE_LIMITS.answers)
        throw new AiError("cap", false, {
          retryAt: resetAt(now, "Africa/Cairo"),
        });
      if (counts.a >= DEVICE_LIMITS.attempts)
        throw new AiError("attempts", false, {
          retryAt: resetAt(now, "Africa/Cairo"),
        });
      this.storage.sql.exec(
        "INSERT INTO leases(id,device,day,cache_key,expires) VALUES(?,?,?,?,?)",
        id,
        device,
        day,
        cacheKey,
        now + OVERALL_MS + 5000,
      );
    });
  }
  private lease(id: string, now: number) {
    const lease = this.rows<Lease>(
      "SELECT * FROM leases WHERE id=? AND expires>?",
      id,
      now,
    )[0];
    if (!lease) throw new AiError("storage");
    return lease;
  }
  attempt(id: string, now: number) {
    this.storage.transactionSync(() => {
      const l = this.lease(id, now);
      const deviceKey = `d:${l.device}:${l.day}`;
      const providerKey = `p:${dayAt(now, "UTC")}`;
      if (this.counter(deviceKey).a >= DEVICE_LIMITS.attempts)
        throw new AiError("attempts", false, {
          retryAt: resetAt(now, "Africa/Cairo"),
        });
      if (this.counter(providerKey).a >= this.limits.daily)
        throw new AiError("quota", false, { retryAt: resetAt(now, "UTC") });
      const recent = this.rows<{ at: number }>(
        "SELECT at FROM attempts WHERE at>? ORDER BY at",
        now - 60000,
      );
      if (recent.length >= this.limits.minute)
        throw new AiError("rate", false, { retryAt: recent[0].at + 60000 });
      this.bump(deviceKey, 0, 1, now);
      this.bump(providerKey, 0, 1, now);
      this.storage.sql.exec("INSERT INTO attempts VALUES(?)", now);
    });
  }
  answered(id: string, now: number) {
    this.storage.transactionSync(() => {
      const l = this.lease(id, now);
      if (l.counted) return;
      this.bump(`d:${l.device}:${l.day}`, 1, 0, now);
      this.storage.sql.exec("UPDATE leases SET counted=1 WHERE id=?", id);
    });
  }
  release(id: string) {
    this.storage.sql.exec("DELETE FROM leases WHERE id=?", id);
  }
  cached(key: string, now: number) {
    return this.rows<{ text: string; model: string }>(
      "SELECT text,model FROM answers WHERE key=? AND expires>?",
      key,
      now,
    )[0];
  }
  save(key: string, text: string, model: string, now: number) {
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        "INSERT OR REPLACE INTO answers VALUES(?,?,?,?,?)",
        key,
        text,
        model,
        now + CACHE_TTL,
        now,
      );
      this.storage.sql.exec(
        "DELETE FROM answers WHERE key IN (SELECT key FROM answers ORDER BY created DESC,key DESC LIMIT -1 OFFSET ?)",
        CACHE_ENTRIES,
      );
    });
  }
}
