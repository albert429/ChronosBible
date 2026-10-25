import { test, expect, type Page } from "@playwright/test";
import {
  completeButton,
  openAppearance,
  ready,
  stubConnection,
  textPoint,
} from "./helpers";

const reading = (page: Page) => page.getByRole("article");
const toolbarBottom = (page: Page) =>
  page.evaluate(() =>
    Math.round(
      document.querySelector(".topbar")!.getBoundingClientRect().bottom,
    ),
  );
/** The verse's top, measured from the bottom of the sticky toolbar. */
async function belowToolbar(page: Page, verse: number) {
  const box = await page.locator(`.verse[data-v="${verse}"]`).boundingBox();
  return box!.y - (await toolbarBottom(page));
}
async function scrollToVerse(page: Page, verse: number) {
  await page.locator(`.verse[data-v="${verse}"]`).evaluate((el) => {
    const top = document.querySelector(".topbar")!.getBoundingClientRect();
    scrollTo({
      top: el.getBoundingClientRect().top + scrollY - top.bottom - 4,
      behavior: "instant",
    });
  });
}

test.beforeEach(async ({ page }) => {
  await stubConnection(page, { saveData: true });
});

test("the next reading is offered after the text, and the title follows it", async ({
  page,
}) => {
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  await expect(page).toHaveTitle("التكوين ١ · الكتاب المقدس");
  const next = page.getByRole("button", { name: "التالي: التكوين ٢" });
  await expect(next).toHaveClass(/text-button/);
  await completeButton(page).click();
  // Marking a reading done promotes «next», but never moves on by itself.
  await expect(next).toHaveClass(/primary/);
  await expect(reading(page)).toHaveAttribute("data-reading", "bible:GEN:1");
  await next.click();
  await ready(page);
  await expect(reading(page)).toHaveAttribute("data-reading", "bible:GEN:2");
  await expect(page).toHaveTitle("التكوين ٢ · الكتاب المقدس");
  expect(new URL(page.url()).search).toBe("?mode=bible&book=GEN&chapter=2");
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("arrow keys page like the toolbar, except inside sheets", async ({
  page,
}) => {
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  await page.keyboard.press("ArrowLeft");
  await expect(reading(page)).toHaveAttribute("data-reading", "bible:GEN:2");
  await page.keyboard.press("ArrowLeft");
  await expect(reading(page)).toHaveAttribute("data-reading", "bible:GEN:3");
  await page.keyboard.press("ArrowRight");
  await expect(reading(page)).toHaveAttribute("data-reading", "bible:GEN:2");
  await openAppearance(page);
  await page.keyboard.press("ArrowLeft");
  await expect(reading(page)).toHaveAttribute("data-reading", "bible:GEN:2");
});

test("a horizontal swipe turns the page; edge swipes and scrolling do not", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Touch input is driven through CDP.");
  await page.goto("/?mode=bible&book=GEN&chapter=2");
  await ready(page);
  const cdp = await page.context().newCDPSession(page);
  async function swipe(from: number, to: number, dy = 0) {
    const y = 400;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: from, y }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: to, y: y + dy }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  // Rightward is forward, as an Arabic book's pages turn.
  await swipe(100, 300);
  await expect(reading(page)).toHaveAttribute("data-reading", "bible:GEN:3");
  await ready(page);
  await swipe(300, 100);
  await expect(reading(page)).toHaveAttribute("data-reading", "bible:GEN:2");
  // From the screen edge (the system's Back gesture): ignored.
  await swipe(8, 260);
  // Mostly vertical: a scroll, not a page turn.
  await swipe(150, 230, 300);
  await page.waitForTimeout(300);
  await expect(reading(page)).toHaveAttribute("data-reading", "bible:GEN:2");
});

test("a reading reopens where it was left, and Back returns to that place", async ({
  page,
}) => {
  await page.goto("/?mode=bible&book=PSA&chapter=119");
  await ready(page);
  await scrollToVerse(page, 60);
  await page.reload();
  await ready(page);
  await expect.poll(() => belowToolbar(page, 60)).toBeGreaterThan(-40);
  expect(await belowToolbar(page, 60)).toBeLessThan(80);
  await page
    .getByRole("button", { name: "الإصحاح التالي", exact: true })
    .click();
  await ready(page);
  // Moving on starts the next reading at its top.
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.goBack();
  await expect(reading(page)).toHaveAttribute("data-reading", "bible:PSA:119");
  await expect.poll(() => belowToolbar(page, 60)).toBeGreaterThan(-40);
  expect(await belowToolbar(page, 60)).toBeLessThan(80);
});

test("choosing the reading already open restarts it without a history entry", async ({
  page,
}) => {
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  await scrollToVerse(page, 20);
  const entries = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: /^اختيار السفر والإصحاح:/ }).click();
  await page
    .getByRole("dialog", { name: "الكتاب المقدس", exact: true })
    .getByRole("button", { name: "التكوين ١", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  expect(await page.evaluate(() => history.length)).toBe(entries);
});

test("a linked verse stays marked until the reader touches the page", async ({
  page,
}) => {
  await page.goto("/?mode=bible&book=JHN&chapter=3&verse=16");
  await ready(page);
  const verse = page.locator('.verse[data-v="16"]');
  await expect(verse).toHaveAttribute("data-selected", "");
  await page.mouse.click(5, 300);
  await expect(verse).not.toHaveAttribute("data-selected", "");
});

test("a verse can be copied with its reference from its study sheet", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Clipboard permissions are Chromium's.",
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  const point = await textPoint(page, 0);
  await page.mouse.click(point.x, point.y);
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "نسخ الآية", exact: true }).click();
  await expect(sheet.getByRole("status")).toHaveText("تم نسخ الآية");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^«فِي .*» \(التكوين ⁦١: ١⁩\)$/);
});
