/**
 * What each offline pack contains, at this build's versioned addresses.
 * Pack contents come from what the build published (the Scripture catalog,
 * the chronology catalogs, the study inventory), never from counts or
 * chapter ranges written here.
 */
import { catalog } from "../../core/scripture/catalog.ts";
import type { ChronologyCatalog } from "../../core/reading/chronology.ts";
import { PLAN_DAYS } from "../../core/reading/schedule.ts";
import { chronologyCatalogs } from "../chronology/data/client.ts";
import { dataUrl } from "../../shared/network/dataVersion.ts";

/** Scripture text (every mode) or verse study for the whole Bible. */
export type Pack = "text" | "study";

export const STUDY_INVENTORY = "/study/v2/inventory.json";
const INVALID = "Invalid study inventory";

/** Every plan day, Bible chapter and chronological reading, plain paths. */
export function textPackPaths(chronologies: readonly ChronologyCatalog[]) {
  return [
    "/readings/plan.json",
    ...Array.from({ length: PLAN_DAYS }, (_, i) => `/readings/${i + 1}.json`),
    ...catalog.flatMap((book) =>
      Array.from(
        { length: book.chapters },
        (_, index) => `/bible/${book.usfm}/${index + 1}.json`,
      ),
    ),
    "/chronology/OT.json",
    "/chronology/NT.json",
    ...chronologies.flatMap((chronology) =>
      chronology.readings.map(
        (reading) => `/chronology/${chronology.testament}/${reading.id}.json`,
      ),
    ),
  ];
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
/** A relative path inside the study folder: no `..`, root or query. */
const safePath = (path: string) =>
  path
    .split("/")
    .every((part) => /^[\w.-]+$/.test(part) && part !== "." && part !== "..");
const RESOURCE =
  /^([^/]+)\/([1-9]\d*)\/(?:index\.json|([1-9]\d*)-([1-9]\d*)\.(?:words\.json\.gz|tr\.json))$/;
/** A Bible chapter's study index, or one verse range's words or translations. */
function chapterResource(path: string) {
  const [, usfm, chapter, start, end] = RESOURCE.exec(path) ?? [];
  const book = catalog.find((item) => item.usfm === usfm);
  return (
    !!book &&
    +chapter <= book.chapters &&
    (start === undefined || +start <= +end)
  );
}

/**
 * The study files the reader's sheet loads (chapter indexes, words and
 * translations), as the build's inventory lists them, relative to
 * /study/v2/. The lexicon shards serve only AI explanations, which need a
 * connection anyway. An inventory that is not the build's, or that names a
 * path outside its folder, is refused rather than saved in part.
 */
export function studyPackPaths(inventory: unknown) {
  if (!object(inventory) || inventory.v !== 2 || !object(inventory.files))
    throw new Error(INVALID);
  const paths = Object.keys(inventory.files);
  if (!paths.every(safePath)) throw new Error(INVALID);
  return paths.filter(chapterResource);
}

async function studyUrls(signal?: AbortSignal) {
  const response = await fetch(dataUrl(STUDY_INVENTORY), { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return studyPackPaths(await response.json()).map((path) =>
    dataUrl(`/study/v2/${path}`),
  );
}

/**
 * Every file a pack needs, at this build's versioned addresses. Cancelling
 * stops the study inventory request; the chronology catalogs are shared
 * with the reader and finish loading for it.
 */
export async function packUrls(
  pack: Pack,
  signal?: AbortSignal,
): Promise<string[]> {
  if (pack === "study") return studyUrls(signal);
  const chronologies = await Promise.all([
    chronologyCatalogs.load("OT"),
    chronologyCatalogs.load("NT"),
  ]);
  signal?.throwIfAborted();
  return textPackPaths(chronologies).map(dataUrl);
}
