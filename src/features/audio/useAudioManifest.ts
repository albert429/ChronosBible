import { useEffect, useState } from "react";
import {
  isBibleChapter,
  isChronologicalReading,
  type ScriptureReading,
} from "../../domain/reading/types";
import { useResource } from "../../shared/hooks/useResource";
import { audioManifests } from "./client";
import { readingKey } from "../../domain/reading/identity";
import { matchesReading } from "../../domain/audio/compatibility";
import { toTimeline, type Timeline } from "../../domain/audio/timeline";
import type { AudioManifest } from "../../domain/audio/types";

const mismatch = (reading: ScriptureReading) =>
  `يحتاج التسجيل إلى تحديث ليتطابق مع ${
    isChronologicalReading(reading)
      ? "نص هذه القراءة"
      : isBibleChapter(reading)
        ? "نص هذا الإصحاح"
        : "قراءة هذا اليوم"
  }.`;

/**
 * Load a reading's manifest and accept it only if it matches the text on
 * screen (identity, passages and transcript hash), as one playable timeline.
 */
export function useAudioManifest(reading: ScriptureReading) {
  const key = readingKey(reading);
  const { data, error, retry } = useResource(audioManifests, key);
  const [checked, setChecked] = useState<{
    data: AudioManifest;
    key: string;
    timeline?: Timeline;
    error?: string;
  }>();
  useEffect(() => {
    if (!data) return;
    let active = true;
    matchesReading(data, reading).then(
      (matches) => {
        if (!active) return;
        if (!matches) audioManifests.invalidate(key);
        setChecked({
          data,
          key,
          timeline: matches ? toTimeline(data, key) : undefined,
          error: matches ? undefined : mismatch(reading),
        });
      },
      (err: Error) => {
        if (active) setChecked({ data, key, error: err.message });
      },
    );
    return () => {
      active = false;
    };
  }, [data, reading, key]);
  const current =
    checked?.data === data && checked?.key === key ? checked : undefined;
  return {
    timeline: current?.timeline,
    error: error || current?.error,
    retry,
  };
}
