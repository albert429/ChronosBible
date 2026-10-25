import { test, expect, type Page } from "@playwright/test";
import {
  article,
  expectAccessible,
  noOverflow,
  openDayDetails,
  ready,
  seed,
} from "./helpers";

// The seeded reader is on day 10 (2026-10-01) with days 2 and 4 completed.
const jumper = (page: Page) =>
  page.getByRole("dialog").getByRole("region", { name: "اذهب إلى يوم" });
const range = (page: Page, name: RegExp) =>
  jumper(page)
    .getByRole("group", { name: "مجموعات الأيام" })
    .getByRole("button", { name });
const dayButton = (page: Page, label: string) =>
  jumper(page).getByRole("button", { name: new RegExp(`^${label}[:،]`) });

test.describe("jump to any plan day", () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await ready(page);
  });

  test("the day menu lists every day, thirty at a time, and opens the one tapped", async ({
    page,
  }) => {
    await openDayDetails(page);
    await expect(jumper(page)).toBeVisible();
    // Starts on the open day's range.
    await expect(range(page, /^الأيام ١ إلى ٣٠$/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const cells = jumper(page).locator(".jumper-day");
    await expect(cells).toHaveCount(30);
    await expect(dayButton(page, "اليوم ١٠")).toHaveAttribute(
      "aria-current",
      "date",
    );
    await expect(dayButton(page, "اليوم ١٠")).toHaveAccessibleName(
      /قراءة اليوم، مفتوح الآن$/,
    );
    await expect(dayButton(page, "اليوم ٢")).toHaveAccessibleName(/مكتمل$/);
    await expect(dayButton(page, "اليوم ٣")).toHaveAccessibleName(/للمتابعة$/);
    await expect(dayButton(page, "اليوم ١١")).toHaveAccessibleName(/قادم$/);
    // Book names join the names once the plan index has loaded.
    await expect(dayButton(page, "اليوم ١")).toHaveAccessibleName(
      /^اليوم ١: \S/,
    );

    await range(page, /^الأيام ٦١ إلى ٩٠$/).click();
    await expect(range(page, /^الأيام ٦١ إلى ٩٠$/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(cells.first()).toHaveText("٦١");
    await dayButton(page, "اليوم ٨٧").click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await ready(page);
    await expect(article(page)).toHaveAttribute("data-day", "87");

    // The menu now opens on day 87's range, with day 87 marked open.
    await openDayDetails(page);
    await expect(range(page, /^الأيام ٦١ إلى ٩٠$/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(dayButton(page, "اليوم ٨٧")).toHaveAccessibleName(
      /مفتوح الآن$/,
    );
  });

  test("the day grid works by keyboard and fits narrow screens in both themes", async ({
    page,
  }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      for (const dark of [false, true]) {
        await page.evaluate((dark) => {
          document.documentElement.dataset.theme = dark ? "dark" : "light";
        }, dark);
        await openDayDetails(page);
        await expect(jumper(page).locator(".jumper-day")).toHaveCount(30);
        await noOverflow(page);
        await expectAccessible(page, { include: "dialog[open]", wcag: true });
        await page.keyboard.press("Escape");
        await expect(page.locator("dialog[open]")).toHaveCount(0);
      }
    }
    await openDayDetails(page);
    await range(page, /^الأيام ١٢١ إلى ١٥٠$/).focus();
    await page.keyboard.press("Enter");
    await dayButton(page, "اليوم ١٥٠").focus();
    await page.keyboard.press("Enter");
    await ready(page);
    await expect(article(page)).toHaveAttribute("data-day", "150");
  });

  test("at 200% zoom the grid narrows to four columns without overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 195, height: 422 });
    await openDayDetails(page);
    const cells = jumper(page).locator(".jumper-day");
    await expect(cells).toHaveCount(30);
    const [a, b, c, d, e] = await Promise.all(
      [0, 1, 2, 3, 4].map(async (i) => (await cells.nth(i).boundingBox())!),
    );
    // Four cells in the first row, the fifth on the next.
    expect(Math.abs(a.y - d.y)).toBeLessThan(2);
    expect(e.y).toBeGreaterThan(a.y + a.height - 1);
    for (const box of [a, b, c, d])
      expect(box.height).toBeGreaterThanOrEqual(44);
    await noOverflow(page);
  });
});
