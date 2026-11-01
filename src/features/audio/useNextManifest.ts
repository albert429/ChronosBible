import { useEffect } from "react";
import { type ReadingLocation } from "../../domain/reading/types.ts";
import { readingKey } from "../../domain/reading/identity.ts";
import { readingHasAudio } from "./availability.ts";
import { audioManifests } from "./client.ts";
import {
  currentConnection,
  type ConnectionFacts,
} from "../../shared/browser/network.ts";

/**
 * True when the reader asked to save data or the connection is very slow.
 * Deliberately looser than reading prefetch (3G still fetches a few
 * kilobytes of timing for a recording that is already playing).
 */
export function constrainedConnection(
  connection: ConnectionFacts | undefined = currentConnection(),
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
  next: ReadingLocation | undefined,
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
