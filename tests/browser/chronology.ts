import type { Page } from "@playwright/test";
import type {
  ChronologicalReadingDefinition,
  ChronologyCatalog,
  PassageOccurrence,
} from "../../src/chronology/types.ts";

/**
 * Small OT/NT chronologies served at the chronology agent's routes
 * (/chronology/{OT,NT}.json and /chronology/{OT,NT}/<id>.json). The UI
 * fetches the canonical chapters itself, so Scripture is the real text.
 */
type Entry = {
  id: string;
  stageId: string;
  substageId?: string;
  title: string;
  estimatedMinutes: number;
  passages: Omit<PassageOccurrence, "id">[];
};
const LONG_TITLE =
  "دعوة إبراهيم والوعد بالنسل والأرض وبركة جميع قبائل الأرض فيه";
const ot: Entry[] = [
  {
    id: "gen-1-1",
    stageId: "beginnings",
    title: "الخلق",
    estimatedMinutes: 6,
    passages: [{ usfm: "GEN", chapter: 1, from: 1, to: 31 }],
  },
  {
    id: "gen-2-1",
    stageId: "beginnings",
    title: "اليوم السابع وجنة عدن",
    estimatedMinutes: 5,
    passages: [{ usfm: "GEN", chapter: 2, from: 1, to: 25 }],
  },
  {
    id: "gen-3-1",
    stageId: "beginnings",
    title: "السقوط",
    estimatedMinutes: 5,
    passages: [{ usfm: "GEN", chapter: 3, from: 1, to: 24 }],
  },
  {
    id: "gen-12-1",
    stageId: "patriarchs",
    substageId: "abraham",
    title: LONG_TITLE,
    estimatedMinutes: 9,
    passages: [
      { usfm: "GEN", chapter: 12, from: 1, to: 20 },
      { usfm: "PSA", chapter: 3, from: 1, to: 8 },
    ],
  },
  {
    id: "job-1-1",
    stageId: "patriarchs",
    substageId: "job",
    title: "أيوب",
    estimatedMinutes: 11,
    passages: [{ usfm: "JOB", chapter: 1, from: 1, to: 22 }],
  },
];
const nt: Entry[] = [
  {
    id: "luk-1-1",
    stageId: "jesus",
    substageId: "birth",
    title: "المقدمة والكلمة",
    estimatedMinutes: 4,
    passages: [
      { usfm: "LUK", chapter: 1, from: 1, to: 4 },
      { usfm: "JHN", chapter: 1, from: 1, to: 18 },
    ],
  },
  {
    id: "mat-5-1",
    stageId: "jesus",
    substageId: "ministry",
    title: "الموعظة على الجبل",
    estimatedMinutes: 8,
    passages: [{ usfm: "MAT", chapter: 5, from: 1, to: 48 }],
  },
  {
    id: "act-1-1",
    stageId: "church",
    title: "صعود المسيح",
    estimatedMinutes: 5,
    passages: [{ usfm: "ACT", chapter: 1, from: 1, to: 26 }],
  },
];

const summary = ({ passages, ...rest }: Entry) => ({
  ...rest,
  verseCount: passages.reduce((sum, p) => sum + p.to - p.from + 1, 0),
});
export const catalogs: Record<"OT" | "NT", ChronologyCatalog> = {
  OT: {
    version: 1,
    testament: "OT",
    title: "العهد القديم بالترتيب الزمني",
    sources: [{ id: "fixture", title: "مصدر الاختبار" }],
    stages: [
      { id: "beginnings", title: "البدايات: الخلق والطوفان" },
      {
        id: "patriarchs",
        title: "الآباء: من إبراهيم إلى يوسف",
        substages: [
          { id: "abraham", title: "إبراهيم" },
          { id: "job", title: "أيوب" },
        ],
      },
    ],
    readings: ot.map(summary),
  },
  NT: {
    version: 1,
    testament: "NT",
    title: "العهد الجديد بالترتيب الزمني",
    sources: [{ id: "fixture", title: "مصدر الاختبار" }],
    stages: [
      {
        id: "jesus",
        title: "حياة يسوع وخدمته",
        substages: [
          { id: "birth", title: "الميلاد والبداية" },
          { id: "ministry", title: "الخدمة" },
        ],
      },
      { id: "church", title: "بداية الكنيسة وانتشار الإنجيل" },
    ],
    readings: nt.map(summary),
  },
};
export const fixtureReadings = { OT: ot, NT: nt };
export { LONG_TITLE };

function definition(
  testament: "OT" | "NT",
  entry: Entry,
): ChronologicalReadingDefinition {
  return {
    ...summary(entry),
    testament,
    passages: entry.passages.map((p, i) => ({ ...p, id: `${entry.id}-${i}` })),
  };
}

/** Serve the fixture chronologies; returns the paths requested. */
export async function stubChronology(page: Page) {
  const requested: string[] = [];
  await page.route("**/chronology/**", (route) => {
    const { pathname } = new URL(route.request().url());
    requested.push(pathname);
    const catalog = /^\/chronology\/(OT|NT)\.json$/.exec(pathname);
    if (catalog)
      return route.fulfill({
        json: catalogs[catalog[1] as "OT" | "NT"],
      });
    const detail = /^\/chronology\/(OT|NT)\/([a-z0-9-]+)\.json$/.exec(pathname);
    const testament = detail?.[1] as "OT" | "NT" | undefined;
    const entry =
      testament &&
      fixtureReadings[testament].find((item) => item.id === detail![2]);
    if (testament && entry)
      return route.fulfill({ json: definition(testament, entry) });
    return route.fulfill({ status: 404, body: "not found" });
  });
  return requested;
}
