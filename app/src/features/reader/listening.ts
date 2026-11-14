import type {
  ReadingLocation,
  ScriptureReading,
} from "../../core/reading/types.ts";
import { readingKey } from "../../core/reading/identity.ts";

/**
 * An open player: the reading and navigation it belongs to. `continuing`
 * marks the session a natural end handed to the next reading.
 */
export type Listening = {
  continuing?: boolean;
  identity: string;
  navigation: number;
  reading: ScriptureReading;
};

/**
 * Whether the player stays open across a navigation: only a session that a
 * native end created for exactly that navigation does. Any other navigation,
 * manual or Back, even to the same reading, closes it.
 */
export const listeningSurvives = (
  listening: Listening | null,
  navigation: number,
  identity: string,
) =>
  !!listening &&
  listening.navigation === navigation &&
  listening.identity === identity;

/**
 * The session a natural end hands to `next`, belonging to the navigation the
 * parent is about to make; the current recording keeps playing its reading
 * until the next one's text arrives.
 */
export const continuedListening = (
  reading: ScriptureReading,
  next: ReadingLocation,
  navigation: number,
): Listening => ({
  continuing: true,
  identity: readingKey(next),
  navigation: navigation + 1,
  reading,
});
