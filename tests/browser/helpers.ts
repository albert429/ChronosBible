import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { PROGRESS_KEY, STATE_KEY } from "../../src/plan/progress.ts";

export const profile = {
  id: "reader-one",
  name: "ميخائيل",
  startDate: "2026-09-22",
  completed: [2, 4],
};

type PlanDay = {
  day: number;
  verseCount: number;
  passages: { book: string }[];
};
const plan: PlanDay[] = JSON.parse(readFileSync("data/plan.json", "utf8"));
/** Facts about a plan day, so tests don't hard-code them. */
export const planDay = (day: number) => plan[day - 1];

/**
 * A device with the legacy (v1) progress of one reader; the app migrates it
 * and that reader opens the youth plan on their scheduled day (day 10 on
 * 2026-10-01). Without `selected`, the guest reads (fresh: Genesis 1).
 */
export async function seed(
  page: Page,
  selected = true,
  time = "2026-10-01T12:00:00Z",
) {
  await page.clock.install({ time: new Date(time) });
  await page.addInitScript(
    ({ key, profile, selected }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            activeId: selected ? profile.id : null,
            profiles: [profile],
          }),
        );
    },
    { key: PROGRESS_KEY, profile, selected },
  );
}
export async function ready(page: Page) {
  await expect(page.locator(".scripture")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
export async function closeSheet(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "إغلاق النافذة", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}
export async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

/** Axe finds nothing; `wcag` limits the rules to WCAG 2.1 A and AA. */
export async function expectAccessible(
  page: Page,
  options: { include?: string; wcag?: boolean } = {},
) {
  let axe = new AxeBuilder({ page });
  if (options.include) axe = axe.include(options.include);
  if (options.wcag) axe = axe.withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
  expect((await axe.analyze()).violations).toEqual([]);
}

export const menuButton = (page: Page) =>
  page.getByRole("button", { name: "فتح القائمة", exact: true });
export const menuDialog = (page: Page) =>
  page.getByRole("dialog", { name: "القائمة", exact: true });
/** Open the menu and choose one of its entries. */
export async function chooseFromMenu(page: Page, target: string) {
  await menuButton(page).click();
  await menuDialog(page)
    .getByRole("button", { name: target, exact: true })
    .click();
}
export async function openAppearance(page: Page) {
  await page
    .getByRole("button", { name: "إعدادات القراءة", exact: true })
    .click();
  return page.getByRole("dialog", { name: "إعدادات القراءة", exact: true });
}
export async function openDayDetails(page: Page) {
  await page.getByRole("button", { name: /^تفاصيل اليوم / }).click();
  return page.getByRole("dialog", { name: /^قراءة اليوم / });
}
/** The youth plan calendar, reached from the day selector. */
export async function openPlanCalendar(page: Page) {
  const details = await openDayDetails(page);
  await details
    .getByRole("button", { name: "أيام الخطة والتقدم", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}
/** The four reading modes' menu names. */
export const MODES = {
  bible: "الكتاب المقدس",
  ot: "العهد القديم بالترتيب الزمني",
  nt: "العهد الجديد بالترتيب الزمني",
  plan: "العهد الجديد في ١٥٠ يومًا",
} as const;
/** The stored v2 state: readers, the guest, places and completion. */
export const storedState = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STATE_KEY);
export const article = (page: Page) => page.getByRole("article");
export const completeButton = (page: Page) =>
  page.getByRole("button", { name: "تمت القراءة", exact: true });
export const undoButton = (page: Page) =>
  page.getByRole("button", { name: "تراجع", exact: true });
export const nextDay = (page: Page) =>
  page.getByRole("button", { name: "اليوم التالي", exact: true });
export const previousDay = (page: Page) =>
  page.getByRole("button", { name: "اليوم السابق", exact: true });

/** The pathnames of the requests the page makes from now on, optionally filtered. */
export function recordRequests(
  page: Page,
  matches: (pathname: string) => boolean = () => true,
) {
  const paths: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (matches(pathname)) paths.push(pathname);
  });
  return paths;
}
export const readingRequests = (page: Page) =>
  recordRequests(page, (pathname) => pathname.includes("/readings/"));

/** A promise that stays pending until `open()` is called. */
export function createGate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}
/** Hold every font request until the returned gate opens. */
export async function blockFonts(page: Page) {
  const gate = createGate();
  await page.route("**/*.woff2", async (route) => {
    await gate.opened;
    await route.continue();
  });
  return gate;
}

/** Make the page report this `navigator.connection`. */
export async function stubConnection(
  page: Page,
  connection: { saveData?: boolean; effectiveType?: string },
) {
  await page.addInitScript(
    (connection) =>
      Object.defineProperty(navigator, "connection", {
        configurable: true,
        value: connection,
      }),
    connection,
  );
}

export const verse = (page: Page, index: number) =>
  page.locator(".verse").nth(index);
/** A point on the verse's own text: the centre of its widest line box. */
export async function textPoint(page: Page, index: number) {
  return verse(page, index).evaluate((el) => {
    const rects = [...el.getClientRects()].sort((a, b) => b.width - a.width);
    return {
      x: rects[0].x + rects[0].width / 2,
      y: rects[0].y + rects[0].height / 2,
    };
  });
}
export async function tap(page: Page, index: number) {
  const { x, y } = await textPoint(page, index);
  await page.mouse.click(x, y);
}
/** Hold the pointer on a point until the page's own clock says the press is no tap. */
export async function longPress(
  page: Page,
  { x, y }: { x: number; y: number },
) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  const start = await page.evaluate(() => performance.now());
  await expect
    .poll(() => page.evaluate((start) => performance.now() - start, start))
    .toBeGreaterThan(500);
  await page.mouse.up();
}
export const study = (page: Page) => page.getByRole("dialog");
/** A section's heading button; its name is the title and, if any, the count. */
export const section = (page: Page, title: string) =>
  study(page).getByRole("button", { name: new RegExp(`^${title}( [٠-٩]+)?$`) });
export async function openSection(page: Page, title: string) {
  await section(page, title).click();
}

/** Tab to the next control; Safari's Tab skips buttons unless Alt is held. */
export const tabKey = (browserName: string) =>
  browserName === "webkit" ? "Alt+Tab" : "Tab";
