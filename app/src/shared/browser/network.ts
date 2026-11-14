/** What the browser reports about the connection (Network Information API). */
export type ConnectionFacts = { saveData?: boolean; effectiveType?: string };

/** The current connection facts, where the browser exposes them. */
export const currentConnection = (): ConnectionFacts | undefined =>
  (navigator as Navigator & { connection?: ConnectionFacts }).connection;

/** Neighbouring readings and code warm up unless saving data or below 4G. */
export function allowsPrefetch(connection?: ConnectionFacts) {
  return (
    !connection?.saveData &&
    !["slow-2g", "2g", "3g"].includes(connection?.effectiveType || "")
  );
}

export function connectionAllowsPrefetch() {
  return allowsPrefetch(currentConnection());
}
