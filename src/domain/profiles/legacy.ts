/**
 * Version 1 data, read only to migrate into the v2 state: youth-plan
 * progress (`nt-reading-progress-v1`) and device places
 * (`bible-reader-location-v1`). Neither is ever written or removed.
 */
import { catalog } from "../scripture/catalog.ts";
import {
  parsePlanOrBibleLocation,
  validPlanOrBibleLocation,
} from "../reading/location.ts";
import type { ReaderPlaces } from "../reading/places.ts";
import type {
  BibleLocation,
  PlanLocation,
  PlanOrBibleLocation,
} from "../reading/types.ts";
import {
  MAX_READERS,
  emptyCompletion,
  freshState,
  validId,
  validateReader,
  type ProgressState,
  type Reader,
} from "./state.ts";

/** The last mode and place in each mode on this device; never plan progress. */
export type ReaderPreferences = {
  version: 1;
  mode: "plan" | "bible";
  /** Each reader's last plan place, by reader id ("" without a reader). */
  plans: Record<string, PlanLocation>;
  bible: BibleLocation;
  continuous: boolean;
};
const MAX_PLAN_READERS = 20;
const validPlans = (value: unknown) =>
  Object.fromEntries(
    Object.entries(
      value && typeof value === "object" && !Array.isArray(value) ? value : {},
    )
      .filter(
        ([reader, place]) =>
          reader.length <= 100 &&
          validPlanOrBibleLocation(place) &&
          (place as PlanOrBibleLocation).mode === "plan",
      )
      .slice(-MAX_PLAN_READERS),
  ) as Record<string, PlanLocation>;
export function loadPreferences(raw?: string | null): ReaderPreferences {
  const initial: ReaderPreferences = {
    version: 1,
    mode: "plan",
    plans: {},
    bible: { mode: "bible", book: "GEN", chapter: 1 },
    continuous: false,
  };
  try {
    const saved: unknown = JSON.parse(raw ?? "null");
    if (!saved || typeof saved !== "object") return initial;
    const value = saved as Partial<ReaderPreferences>;
    if (value.version !== 1) return initial;
    return {
      ...initial,
      mode: value.mode === "bible" ? "bible" : "plan",
      plans: validPlans(value.plans),
      bible:
        validPlanOrBibleLocation(value.bible) && value.bible.mode === "bible"
          ? value.bible
          : initial.bible,
      continuous: value.continuous === true,
    };
  } catch {
    return initial;
  }
}
/** A reader's last plan place, or their scheduled day before they have one. */
export const planLocation = (
  preferences: ReaderPreferences,
  reader: string,
  scheduled: number,
): PlanLocation =>
  // Own properties only: ids such as "constructor" or "__proto__" are valid.
  (Object.prototype.hasOwnProperty.call(preferences.plans, reader)
    ? preferences.plans[reader]
    : undefined) ?? { mode: "plan", day: scheduled };
/** Move to a place; a plan place belongs to the active reader only. */
export function withLocation(
  preferences: ReaderPreferences,
  reader: string,
  location: PlanOrBibleLocation,
): ReaderPreferences {
  if (location.mode === "bible")
    return { ...preferences, mode: "bible", bible: location };
  const others = Object.entries(preferences.plans).filter(
    ([id]) => id !== reader,
  );
  return {
    ...preferences,
    mode: "plan",
    plans: {
      ...Object.fromEntries(others.slice(-(MAX_PLAN_READERS - 1))),
      [reader]: location,
    },
  };
}
export function initialPreferences(
  reader: string,
  search: string,
  raw?: string | null,
) {
  const saved = loadPreferences(raw);
  const linked = parsePlanOrBibleLocation(search, catalog);
  return linked ? withLocation(saved, reader, linked) : saved;
}
/** Legacy v1 preferences as one reader's v2 places. */
export function placesFromPreferences(
  preferences: ReaderPreferences,
  reader: string,
): ReaderPlaces {
  const plan = Object.prototype.hasOwnProperty.call(preferences.plans, reader)
    ? preferences.plans[reader]
    : undefined;
  return {
    track: preferences.mode,
    places: { bible: preferences.bible, ...(plan ? { plan } : {}) },
  };
}

/** Legacy v1 progress, validated exactly as before. */
function legacyProgress(raw: string) {
  const data = JSON.parse(raw);
  if (
    data.version !== 1 ||
    !Array.isArray(data.profiles) ||
    data.profiles.length > MAX_READERS
  )
    throw Error();
  const profiles: Reader[] = data.profiles.map((p: Reader) => {
    if (!validId(p.id)) throw Error();
    return { id: p.id, ...validateReader(p) };
  });
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length)
    throw Error();
  if (data.activeId !== null && !profiles.some((p) => p.id === data.activeId))
    throw Error();
  return { activeId: data.activeId as string | null, profiles };
}

/**
 * The v2 state built from v1 progress and v1 device places. Readers keep
 * their mode and places; v1 completed days are youth plan days. Without any
 * v1 data this is the fresh state (the Bible at Genesis 1).
 */
export function migrateLegacy(
  progress: string | null,
  location: string | null,
): ProgressState {
  if (!progress && !location) return freshState();
  const preferences = loadPreferences(location);
  const { activeId, profiles } = progress
    ? legacyProgress(progress)
    : { activeId: null, profiles: [] };
  return {
    version: 2,
    activeId,
    profiles: profiles.map((r) => ({
      ...r,
      ...placesFromPreferences(preferences, r.id),
      completion: emptyCompletion(r.completed),
    })),
    guest: {
      ...placesFromPreferences(preferences, ""),
      completion: emptyCompletion(),
    },
    continuous: preferences.continuous,
  };
}
