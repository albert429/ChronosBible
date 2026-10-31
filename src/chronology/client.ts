import { catalog as books } from "../bible/catalog.ts";
import { chapters } from "../bible/client.ts";
import {
  readingKey,
  type BibleChapter,
  type ChronologicalLocation,
  type Testament,
} from "../bible/types.ts";
import { createJsonClient } from "../lib/jsonClient.ts";
import { dataUrl } from "../lib/dataVersion.ts";
import { isChronologyId } from "./types.ts";
import type {
  ChronologicalPassage,
  ChronologicalReading,
  ChronologicalReadingDefinition,
  ChronologyCatalog,
} from "./types.ts";
import {
  chronologyDefinitionErrors,
  isChronologicalReadingData,
  isChronologyCatalog,
} from "./validate.ts";

export * from "./navigation.ts";

type ChapterSource = { load(key: string): Promise<BibleChapter> };

const isTestament = (value: string): value is Testament =>
  value === "OT" || value === "NT";

/** `chrono:OT|NT:<id>` back to its location, or undefined if malformed. */
export function chronologicalKeyLocation(
  key: string,
): ChronologicalLocation | undefined {
  const match = /^chrono:(OT|NT):(.+)$/.exec(key);
  if (!match || !isTestament(match[1]) || !isChronologyId(match[2])) return;
  return { mode: "chronological", testament: match[1], readingId: match[2] };
}

/** A definition's verse ranges cut from their canonical chapters. */
export function assembleChronologicalReading(
  definition: ChronologicalReadingDefinition,
  loaded: readonly BibleChapter[],
): ChronologicalReading {
  const passages = definition.passages.map(
    (occurrence, i): ChronologicalPassage => {
      const chapter = loaded[i];
      const { from, to } = occurrence;
      return {
        book: chapter.book,
        chapter: occurrence.chapter,
        start: from,
        end: to,
        verses: chapter.passages[0].verses.slice(from - 1, to),
        occurrenceId: occurrence.id,
        ...(occurrence.provenance ? { provenance: occurrence.provenance } : {}),
        structure: chapter.structure.filter(
          (block) => block.verse >= from && block.verse <= to,
        ),
      };
    },
  );
  return {
    id: definition.id,
    stageId: definition.stageId,
    ...(definition.substageId ? { substageId: definition.substageId } : {}),
    title: definition.title,
    estimatedMinutes: definition.estimatedMinutes,
    ...(definition.provenance ? { provenance: definition.provenance } : {}),
    mode: "chronological",
    testament: definition.testament,
    verseCount: passages.reduce((sum, p) => sum + p.verses.length, 0),
    passages,
  };
}

/**
 * Catalogs (`OT`/`NT`) and readings (`chrono:OT|NT:<id>`), loaded only when
 * asked for. A reading fetches its small definition, then just the canonical
 * chapters it needs through the shared Bible chapter cache.
 */
export function createChronologyClients(
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
  bible: ChapterSource = chapters,
) {
  const catalogs = createJsonClient<ChronologyCatalog>(
    {
      url: (key) => {
        if (!isTestament(key)) throw new Error("Invalid testament");
        return dataUrl(`/chronology/${key}.json`);
      },
      validate: (data, key): data is ChronologyCatalog =>
        isTestament(key) && isChronologyCatalog(data, key),
      message: () =>
        "تعذر تحميل فهرس القراءة الزمنية. تحقق من الاتصال وحاول مرة أخرى.",
    },
    fetcher,
    timeoutMs,
  );
  const definitions = createJsonClient<ChronologicalReadingDefinition>(
    {
      url: (key) => {
        const location = chronologicalKeyLocation(key);
        if (!location) throw new Error("Invalid chronological reading key");
        return dataUrl(
          `/chronology/${location.testament}/${location.readingId}.json`,
        );
      },
      validate: (data, key): data is ChronologicalReadingDefinition => {
        const location = chronologicalKeyLocation(key);
        return (
          !!location &&
          chronologyDefinitionErrors(
            data,
            location.testament,
            location.readingId,
            books,
          ).length === 0
        );
      },
      message: () => "تعذر تحميل القراءة. تحقق من الاتصال وحاول مرة أخرى.",
    },
    fetcher,
    timeoutMs,
  );

  // Same contract as createJsonClient: shared pending requests, successes
  // cached, failures never cached so a retry starts again.
  const cache = new Map<string, ChronologicalReading>();
  const pending = new Map<string, Promise<ChronologicalReading>>();
  function load(key: string): Promise<ChronologicalReading> {
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    const existing = pending.get(key);
    if (existing) return existing;
    const request = definitions
      .load(key)
      .then(async (definition) => {
        const loaded = await Promise.all(
          definition.passages.map((p) =>
            bible.load(`bible:${p.usfm}:${p.chapter}`),
          ),
        );
        const reading = assembleChronologicalReading(definition, loaded);
        if (
          !isChronologicalReadingData(
            reading,
            definition.testament,
            definition.id,
          )
        )
          throw new Error("Invalid chronological reading");
        cache.set(key, reading);
        return reading;
      })
      .catch((cause) => {
        throw new Error("تعذر تحميل القراءة. تحقق من الاتصال وحاول مرة أخرى.", {
          cause,
        });
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, request);
    return request;
  }
  const readings = {
    load,
    peek: (key: string) => cache.get(key),
    invalidate: (key: string) => {
      cache.delete(key);
      definitions.invalidate(key);
    },
    // Background failures are silent; load keeps normal retry behaviour.
    prefetchReading: (location: ChronologicalLocation): Promise<void> =>
      load(readingKey(location)).then(
        () => {},
        () => {},
      ),
  };
  return { catalogs, readings };
}

export const { catalogs: chronologyCatalogs, readings: chronologicalReadings } =
  createChronologyClients();
