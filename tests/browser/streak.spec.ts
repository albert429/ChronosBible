import { test, expect, type Page } from "@playwright/test";
import {
  MODES,
  chooseFromMenu,
  completeButton,
  expectAccessible,
  menuButton,
  menuDialog,
  nextDay,
  noOverflow,
  openDayDetails,
  openPlanCalendar,
  previousDay,
  ready,
  seed,
  storedState,
  undoButton,
} from "./helpers";
import { STATE_KEY } from "../../src/plan/progress.ts";

const ribbon = (page: Page) =>
  page.getByRole("dialog").getByRole("region", { name: "سلسلة القراءة" });
const moment = (page: Page) => page.locator(".streak-moment");
const milestone = (page: Page) =>
  page.locator(".streak-milestone[role=status]");

/**
 * A reader on plan day 10 (2026-10-20 in Cairo) who read six of the last seven
 * days: 10-13, 10-14, a rest day on 10-15, then 10-16 to 10-19.
 */
async function seedStreak(page: Page) {
  const days = [1, 2, 3, 4, 5, 6];
  const dates = [
    "2026-10-13",
    "2026-10-14",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
    "2026-10-19",
  ];
  const completion = {
    bible: [],
    plan: days,
    "chrono:OT": [],
    "chrono:NT": [],
  };
  await page.clock.install({ time: new Date("2026-10-20T09:00:00Z") });
  await page.addInitScript(
    ({ key, state }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(state));
    },
    {
      key: STATE_KEY,
      state: {
        version: 2,
        activeId: "reader-one",
        continuous: false,
        guest: {
          track: "bible",
          places: {},
          completion: { bible: [], plan: [], "chrono:OT": [], "chrono:NT": [] },
        },
        profiles: [
          {
            id: "reader-one",
            name: "ميخائيل",
            startDate: "2026-10-11",
            track: "plan",
            places: {},
            completion,
            readOn: Object.fromEntries(
              days.map((day, i) => [`plan|${day}`, dates[i]]),
            ),
          },
        ],
      },
    },
  );
}

test.describe("reading streaks", () => {
  test("marking a reading done starts a streak; undoing removes its date", async ({
    page,
  }) => {
    // Legacy progress: completed days without dates start no streak.
    await seed(page);
    await page.goto("/");
    await ready(page);
    await openDayDetails(page);
    await expect(ribbon(page)).toContainText("ابدأ سلسلتك اليوم");
    await page.keyboard.press("Escape");

    await completeButton(page).click();
    await expect(moment(page)).toContainText("سلسلة القراءة: يوم واحد");
    // A one-day streak is no milestone.
    await expect(milestone(page)).toHaveCount(0);
    const stored = await storedState(page);
    expect(stored.profiles[0].readOn).toEqual({ "plan|10": "2026-10-01" });

    await menuButton(page).click();
    await expect(ribbon(page)).toContainText("يوم واحد");
    await expect(ribbon(page)).toContainText("قرأت اليوم. أحسنت!");
    await page.keyboard.press("Escape");

    await undoButton(page).click();
    await expect(moment(page)).toHaveCount(0);
    expect((await storedState(page)).profiles[0].readOn).toBeUndefined();
  });

  test("a growing streak lights up and celebrates its milestone once", async ({
    page,
  }) => {
    await seedStreak(page);
    await page.goto("/");
    await ready(page);
    await openDayDetails(page);
    await expect(ribbon(page)).toContainText("٦ أيام متتالية");
    await expect(ribbon(page)).toContainText("اقرأ اليوم لتحافظ على سلسلتك.");
    await expect(ribbon(page).getByRole("img")).toHaveAccessibleName(
      "آخر سبعة أيام: قراءة في ٥ أيام، ويوم راحة",
    );
    await page.keyboard.press("Escape");

    await completeButton(page).click();
    await expect(moment(page)).toContainText("٧ أيام متتالية");
    await expect(milestone(page)).toContainText("٧ أيام متتالية!");
    await expect(milestone(page)).toContainText("أسبوع كامل مع كلمة الله.");
    await expect(milestone(page)).toBeInViewport();

    // Another reading the same day keeps the count and has no new card.
    await nextDay(page).click();
    await ready(page);
    await completeButton(page).click();
    await expect(moment(page)).toContainText("٧ أيام متتالية");
    await expect(milestone(page)).toHaveCount(0);
    // Returning to a reading already done shows the streak without a card.
    await previousDay(page).click();
    await ready(page);
    await expect(moment(page)).toContainText("٧ أيام متتالية");
    await expect(milestone(page)).toHaveCount(0);

    // The plan calendar shows the streak too.
    await openPlanCalendar(page);
    await expect(
      page.getByRole("img", { name: "سلسلة القراءة: ٧ أيام متتالية" }),
    ).toBeVisible();
  });

  test("readings in every track count toward the same streak", async ({
    page,
  }) => {
    await seedStreak(page);
    await page.goto("/");
    await ready(page);
    await chooseFromMenu(page, MODES.bible);
    await ready(page);
    await completeButton(page).click();
    await expect(moment(page)).toContainText("٧ أيام متتالية");
    const readOn = (await storedState(page)).profiles[0].readOn;
    expect(
      Object.entries(readOn).filter(([, d]) => d === "2026-10-20"),
    ).toEqual([[expect.stringMatching(/^bible\|/), "2026-10-20"]]);
  });

  test("streak cards are accessible in both themes, fit 320px and stay still with reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedStreak(page);
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/");
    await ready(page);
    for (const dark of [false, true]) {
      await page.evaluate((dark) => {
        document.documentElement.dataset.theme = dark ? "dark" : "light";
      }, dark);
      await menuButton(page).click();
      await expect(ribbon(page)).toBeVisible();
      await noOverflow(page);
      await expectAccessible(page, { include: "dialog[open]", wcag: true });
      await page.keyboard.press("Escape");
      await expect(menuDialog(page)).toBeHidden();
    }
    await completeButton(page).click();
    await expect(milestone(page)).toBeVisible();
    expect(
      await milestone(page).evaluate(
        (el) => getComputedStyle(el).animationName,
      ),
    ).toBe("none");
    await noOverflow(page);
    await expectAccessible(page, {
      include: ".reading-completion",
      wcag: true,
    });
  });
});
