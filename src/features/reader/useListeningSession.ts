import { useCallback, useRef, useState } from "react";
import type {
  ReadingLocation,
  ScriptureReading,
} from "../../domain/reading/types";
import { playbackPosition, savePlaybackPosition } from "../audio/position";
import {
  continuedListening,
  listeningSurvives,
  type Listening,
} from "./listening";

/**
 * The reader's player session: opening and closing it from the listen
 * button, its saved playback position, and continuing to the next reading
 * on a natural end. Completion is never implied; the player only offers it.
 */
export function useListeningSession({
  current,
  identity,
  navigation,
  onContinue,
}: {
  current: ScriptureReading | undefined;
  identity: string;
  navigation: number;
  /** Moves on to the next reading without taking keyboard focus. */
  onContinue: (location: ReadingLocation) => void;
}) {
  const [listening, setListening] = useState<Listening | null>(null);
  const playerSource = useRef<string | null>(null);
  const listenButton = useRef<HTMLButtonElement>(null);
  const toggle = useCallback(() => {
    setListening((active) =>
      active || !current ? null : { identity, navigation, reading: current },
    );
  }, [current, identity, navigation]);
  // While the next reading's text is cold, the player keeps the previous one.
  const reading = listening && (current || listening.reading);
  return {
    listening,
    /** The reading the player plays, while it is open. */
    reading,
    listenButton,
    toggle,
    /**
     * Called while rendering a new navigation (the text may still be cold):
     * only the session a native end created for it survives.
     */
    navigated() {
      if (!listeningSurvives(listening, navigation, identity))
        setListening(null);
    },
    /** The player's session callbacks. */
    player: {
      initialTime: (source: string) =>
        listening?.continuing ? 0 : playbackPosition(source),
      onPosition(seconds: number, source: string) {
        playerSource.current = source;
        savePlaybackPosition(source, seconds);
      },
      /** The natural end, with the place «متابعة» continues to, if any. */
      onEnded(next?: ReadingLocation) {
        if (playerSource.current) savePlaybackPosition(playerSource.current, 0);
        if (!reading || !next) return;
        setListening(continuedListening(reading, next, navigation));
        onContinue(next);
      },
      /** Closes the player and returns focus to the listen button. */
      onClose() {
        const trigger = listenButton.current;
        setListening(null);
        requestAnimationFrame(() => {
          if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        });
      },
    },
  };
}
