import type {
  ReadingLocation,
  ScriptureReading,
} from "../../domain/reading/types.ts";
import {
  audioAvailable,
  type AdvertisedAudio,
} from "../../domain/audio/availability.ts";

// Inlined by vite.config.ts: verified chronological playlists, as reading
// keys. Declared here, not in the shared src/vite-env.d.ts.
declare const __AUDIO_READINGS__: string[];

let advertised: AdvertisedAudio | undefined;
/**
 * `audioAvailable` for this build's advertised audio (vite.config.ts), built
 * once: the inlined lists become sets instead of new arrays on every call.
 */
export const readingHasAudio = (target: ReadingLocation | ScriptureReading) =>
  audioAvailable(
    target,
    (advertised ??= {
      days: new Set(__AUDIO_DAYS__),
      chapters: __AUDIO_CHAPTERS__,
      readings: new Set(__AUDIO_READINGS__),
    }),
  );
