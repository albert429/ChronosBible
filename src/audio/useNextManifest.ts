import { useEffect } from "react";
import { readingKey, type AnyReadingLocation } from "../bible/types.ts";
import { readingHasAudio } from "./availability.ts";
import { audioManifests } from "./client.ts";

type Connection = { saveData?: boolean; effectiveType?: string };

/** True when the reader asked to save data or the connection is very slow. */
export function constrainedConnection(
  connection: Connection | undefined = (
    navigator as Navigator & { connection?: Connection }
  ).connection,
) {
  return (
    !!connection?.saveData ||
    ["slow-2g", "2g"].includes(connection?.effectiveType ?? "")
  );
}

/**
 * Once playback has really started, fetch only the continuation's timing JSON
 * (a few kilobytes; never audio), so the handoff does not wait on it. Skipped
 * for readings without published audio and on constrained connections.
 */
export function useNextManifest(
  next: AnyReadingLocation | undefined,
  playing: boolean,
) {
  const key = next && readingHasAudio(next) ? readingKey(next) : undefined;
  useEffect(() => {
    if (!playing || !key || constrainedConnection()) return;
    audioManifests.load(key).catch(() => {
      /* The handoff loads it again and reports any failure. */
    });
  }, [playing, key]);
}
