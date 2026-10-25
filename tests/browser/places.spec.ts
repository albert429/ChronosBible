import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PROGRESS_KEY } from "../../src/plan/progress.ts";
import {
  MODES,
  article,
  chooseFromMenu,
  menuButton,
  menuDialog,
  nextDay,
  profile,
  ready,
  seed,
  storedState,
  stubConnection,
} from "./helpers";

// Reader one's scheduled day on 2026-10-01 is 10; reader two's is 5.
const second = {
  id: "reader-two",
  name: "مريم",
  startDate: "2026-09-27",
  completed: [1],
};
async function seedTwo(page: Page) {
  await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
  // Only on the first visit, so later loads see what the app itself stored.
  await page.addInitScript(
    ({ key, profiles }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({ version: 1, activeId: profiles[0].id, profiles }),
        );
    },
    { key: PROGRESS_KEY, profiles: [profile, second] },
  );
}
const search = (page: Page) => new URL(page.url()).search;
const completions = async (page: Page) =>
  (await storedState(page)).profiles.map(
    (reader: { completion: unknown }) => reader.completion,
  );
const nextChapter = (page: Page) =>
  page.getByRole("button", { name: "الإصحاح التالي", exact: true });
async function switchReader(page: Page, id: string) {
  await chooseFromMenu(page, "إعدادات القارئ");
  await page
    .getByRole("button", { name: "تغيير القارئ على هذا الجهاز" })
    .click();
  await page.getByLabel("متابعة قارئ محفوظ").selectOption(id);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await ready(page);
}

test("each reader keeps their own place in every mode across launches", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  await seedTwo(page);
  await page.goto("/");
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "10");
  const before = await completions(page);
  await nextDay(page).click();
  await nextDay(page).click();
  await expect(article(page)).toHaveAttribute("data-day", "12");
  expect(search(page)).toBe("");
  // A fresh launch and a reload both return to the last day read.
  await page.goto("/");
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "12");
  await page.reload();
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "12");
  // Another reader has no place yet: their scheduled day, not reader one's.
  await switchReader(page, second.id);
  await expect(article(page)).toHaveAttribute("data-day", "5");
  await nextDay(page).click();
  await expect(article(page)).toHaveAttribute("data-day", "6");
  await switchReader(page, profile.id);
  await expect(article(page)).toHaveAttribute("data-day", "12");
  // The Bible place belongs to each reader too.
  await chooseFromMenu(page, MODES.bible);
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:1");
  await nextChapter(page).click();
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:2");
  await switchReader(page, second.id);
  await expect(article(page)).toHaveAttribute("data-day", "6");
  await chooseFromMenu(page, MODES.bible);
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:1");
  await switchReader(page, profile.id);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:2");
  await chooseFromMenu(page, MODES.plan);
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "12");
  await page.goto("/");
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "12");
  // Navigation never touches completion records.
  expect(await completions(page)).toEqual(before);
  const [one, two] = (await storedState(page)).profiles;
  expect(one.places).toEqual({
    plan: { mode: "plan", day: 12 },
    bible: { mode: "bible", book: "GEN", chapter: 2 },
  });
  expect(two.places).toEqual({
    plan: { mode: "plan", day: 6 },
    bible: { mode: "bible", book: "GEN", chapter: 1 },
  });
  expect(two.track).toBe("bible");
});

test("explicit day links are honoured and kept on reload; in-app days use the bare URL", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  await seed(page);
  await page.goto("/?day=7");
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "7");
  expect(search(page)).toBe("?day=7");
  await page.reload();
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "7");
  expect(search(page)).toBe("?day=7");
  await nextDay(page).click();
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "8");
  expect(search(page)).toBe("");
  await page.reload();
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "8");
  await page.goBack();
  await expect(article(page)).toHaveAttribute("data-day", "7");
  expect(search(page)).toBe("?day=7");
  // An invalid link falls back to the remembered place and is not kept.
  await page.goto("/?day=151");
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "7");
  expect(search(page)).toBe("");
  // A chapter link keeps its own address and leaves the plan place alone.
  await page.goto("/?mode=bible&book=PSA&chapter=23&verse=1");
  await ready(page);
  expect(search(page)).toBe("?mode=bible&book=PSA&chapter=23&verse=1");
  await chooseFromMenu(page, MODES.plan);
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "7");
});

test("backups carry a reader's progress and places; restoring adds a separate reader", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  await seed(page);
  await page.goto("/");
  await ready(page);
  await nextDay(page).click();
  await ready(page);
  await chooseFromMenu(page, MODES.bible);
  await ready(page);
  await nextChapter(page).click();
  await ready(page);
  await menuButton(page).click();
  await menuDialog(page)
    .getByText("النسخ الاحتياطي والاستعادة", { exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "تنزيل نسخة احتياطية", exact: true })
    .click();
  const path = (await (await downloadPromise).path())!;
  const backup = JSON.parse(readFileSync(path, "utf8"));
  expect(Object.keys(backup).sort()).toEqual(["reader", "version"]);
  expect(backup.version).toBe(2);
  expect(Object.keys(backup.reader).sort()).toEqual([
    "completion",
    "name",
    "places",
    "startDate",
    "track",
  ]);
  expect(backup.reader.track).toBe("bible");
  expect(backup.reader.places).toEqual({
    plan: { mode: "plan", day: 11 },
    bible: { mode: "bible", book: "GEN", chapter: 2 },
  });
  expect(backup.reader.completion.plan).toEqual([2, 4]);
  await page.getByLabel("ملف النسخة الاحتياطية").setInputFiles(path);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await ready(page);
  // The restored reader is active and resumes the places in the backup.
  const state = await storedState(page);
  expect(state.profiles).toHaveLength(2);
  expect(state.activeId).toBe(state.profiles[1].id);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:2");
  await chooseFromMenu(page, MODES.plan);
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "11");
  await switchReader(page, profile.id);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:2");
});
