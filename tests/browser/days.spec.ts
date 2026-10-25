import { test, expect } from "@playwright/test";
import {
  closeSheet,
  openPlanCalendar,
  nextDay,
  openDayDetails,
  planDay,
  previousDay,
  ready,
  seed,
} from "./helpers";

test.describe("day details", () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await ready(page);
  });

  test("day details jump to passages below the sticky toolbar and offer Today only away from today", async ({
    page,
  }) => {
    let details = await openDayDetails(page);
    await expect(
      details.getByRole("button", { name: "قراءة اليوم", exact: true }),
    ).toHaveCount(0);
    await closeSheet(page);
    await previousDay(page).click();
    await ready(page);
    details = await openDayDetails(page);
    const passageLink = details.locator('a[href^="#passage-"]').last();
    const target = await passageLink.getAttribute("href");
    await passageLink.click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const heading = page.locator(`${target} h2`);
    await expect(heading).toBeInViewport();
    expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(60);
    details = await openDayDetails(page);
    await details
      .getByRole("button", { name: "قراءة اليوم", exact: true })
      .click();
    await ready(page);
    await expect(page.getByRole("article")).toHaveAttribute("data-day", "10");
  });
});

test.describe("calendar and plan boundaries", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?day=1");
    await ready(page);
  });

  test("the longest reading and plan boundaries keep navigation and Scripture intact", async ({
    page,
  }) => {
    await expect(previousDay(page)).toBeDisabled();
    await openPlanCalendar(page);
    await expect(page.locator(".calendar-day")).toHaveCount(30);
    for (let i = 0; i < 4; i++)
      await page
        .getByRole("button", { name: "الأيام التالية", exact: true })
        .click();
    await page.locator(".calendar-day").nth(22).click();
    await ready(page);
    await expect(page.getByRole("article")).toHaveAttribute("data-day", "143");
    await expect(page.locator(".verse")).toHaveCount(planDay(143).verseCount);
    await expect(page.locator(".passage h2 bdi").first()).toBeVisible();
    await openPlanCalendar(page);
    await page.locator(".calendar-day").last().click();
    await ready(page);
    await expect(page.getByRole("article")).toHaveAttribute("data-day", "150");
    await expect(nextDay(page)).toBeDisabled();
    await previousDay(page).click();
    await ready(page);
    await expect(page.getByRole("article")).toHaveAttribute("data-day", "149");
  });
});
