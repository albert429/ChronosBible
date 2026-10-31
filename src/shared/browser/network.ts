type Connection = { saveData?: boolean; effectiveType?: string };

export function allowsPrefetch(connection?: Connection) {
  return (
    !connection?.saveData &&
    !["slow-2g", "2g", "3g"].includes(connection?.effectiveType || "")
  );
}

export function connectionAllowsPrefetch() {
  return allowsPrefetch(
    (navigator as Navigator & { connection?: Connection }).connection,
  );
}
