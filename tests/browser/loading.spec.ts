import { test, expect } from "@playwright/test";
import { STATE_KEY } from "../../src/plan/progress.ts";
import {
  MODES,
  blockFonts,
  chooseFromMenu,
  openPlanCalendar,
  createGate,
  nextDay,
  planDay,
  previousDay,
  readingRequests,
  ready,
  recordRequests,
  seed,
  stubConnection,
} from "./helpers";

test.describe("loading and caching", () => {
  test("a fresh visitor loads only Genesis 1: no plan, chronology, audio or About logo", async ({
    page,
  }) => {
    await stubConnection(page, { saveData: true });
    const requests = recordRequests(page, (path) =>
      /^\/(bible|readings|chronology|audio|study)\/|church-logo|About|ChronologyPanel|AudioPlayer/.test(
        path,
      ),
    );
    await page.goto("/");
    await ready(page);
    await expect(page.getByRole("article")).toHaveAttribute(
      "data-reading",
      "bible:GEN:1",
    );
    await page.waitForLoadState("networkidle");
    expect(requests).toEqual(["/bible/GEN/1.json"]);
  });

  test("returning reader fetches their day first; revisits and calendar are cached", async ({
    page,
  }) => {
    await seed(page);
    const requests = readingRequests(page);
    await page.goto("/");
    await ready(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "اليوم ١٠",
    );
    expect(requests[0]).toBe("/readings/10.json");
    expect(
      requests.every((url) => /^\/readings\/(9|10|11)\.json$/.test(url)),
    ).toBe(true);
    await nextDay(page).click();
    await ready(page);
    await previousDay(page).click();
    await ready(page);
    expect(requests.filter((url) => url === "/readings/10.json")).toHaveLength(
      1,
    );
    await openPlanCalendar(page);
    await expect(page.locator(".calendar-day")).toHaveCount(30);
    await chooseFromMenu(page, MODES.plan);
    await ready(page);
    await openPlanCalendar(page);
    await expect(page.locator(".calendar-day")).toHaveCount(30);
    expect(requests.filter((url) => url.endsWith("plan.json"))).toHaveLength(1);
  });

  test("reading and calendar errors have working independent retry controls", async ({
    page,
  }) => {
    let failDay = true;
    let failPlan = true;
    await page.route("**/readings/1.json*", (route) =>
      failDay
        ? route.fulfill({ status: 503, body: "failed" })
        : route.continue(),
    );
    await page.route("**/readings/plan.json*", (route) =>
      failPlan
        ? route.fulfill({ status: 503, body: "failed" })
        : route.continue(),
    );
    await page.goto("/?day=1");
    await expect(page.getByRole("alert")).toContainText("تعذر تحميل القراءة");
    await expect(
      page.getByRole("button", { name: "تمت القراءة", exact: true }),
    ).toHaveCount(0);
    failDay = false;
    await page.getByRole("button", { name: "إعادة المحاولة" }).click();
    await ready(page);
    await openPlanCalendar(page);
    await expect(page.getByRole("alert")).toContainText(
      "تعذر تحميل خطة القراءة",
    );
    failPlan = false;
    await page.getByRole("button", { name: "إعادة المحاولة" }).click();
    await expect(page.locator(".calendar-day")).toHaveCount(30);
  });

  test("late responses cannot replace the selected day's Scripture", async ({
    page,
  }) => {
    const gate = createGate();
    await page.route("**/readings/2.json*", async (route) => {
      await gate.opened;
      await route.continue();
    });
    await page.goto("/?day=1");
    await ready(page);
    const requested = page.waitForRequest("**/readings/2.json*");
    await nextDay(page).click();
    await requested;
    await nextDay(page).click();
    await ready(page);
    const response = page.waitForResponse("**/readings/2.json*");
    gate.open();
    await response;
    await expect(page.getByRole("article")).toHaveAttribute("data-day", "3");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "اليوم ٣",
    );
  });
});

test.describe("first reading", () => {
  /** What index.html started fetching before the app ran. */
  const preloads = (page: import("@playwright/test").Page) =>
    page.evaluate(() =>
      Object.keys(
        (window as unknown as { __earlyData?: object }).__earlyData ?? {},
      ),
    );

  test("the reading's text is fetched with the page, once, by its versioned address", async ({
    page,
  }) => {
    await stubConnection(page, { saveData: true });
    const urls: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/bible/"))
        urls.push(url.pathname + url.search);
    });
    await page.goto("/");
    await ready(page);
    const [first] = await preloads(page);
    expect(first).toMatch(/^\/bible\/GEN\/1\.json\?v=[0-9a-f]{10}$/);
    await page.waitForLoadState("networkidle");
    // The app's own request reuses the preload.
    expect(urls).toEqual([first]);
    // The next launch starts with the reading open at the end of this one.
    await page
      .getByRole("button", { name: "الإصحاح التالي", exact: true })
      .click();
    await ready(page);
    // Written once the page has settled, never during the first screen.
    await expect
      .poll(
        () =>
          page.evaluate(() => localStorage.getItem("bible-reader-preload-v1")),
        { timeout: 10000 },
      )
      .toBe('["/bible/GEN/2.json"]');
    await page.reload();
    await ready(page);
    expect(await preloads(page)).toEqual([
      first.replace("/GEN/1.json", "/GEN/2.json"),
    ]);
  });

  test("a returning reader from before preloading, and links, get no wrong guess", async ({
    page,
  }) => {
    await seed(page);
    await page.goto("/");
    await ready(page);
    expect(await preloads(page)).toEqual([]);
    await page.goto("/?mode=bible&book=JHN&chapter=3");
    await ready(page);
    expect(await preloads(page)).toEqual([
      expect.stringMatching(/^\/bible\/JHN\/3\.json\?v=/),
    ]);
  });
});

test.describe("prefetch", () => {
  test("fonts gate adjacent prefetch and a warmed reading opens without a loading flash", async ({
    page,
  }) => {
    const requests = recordRequests(page);
    const fonts = await blockFonts(page);
    await page.goto("/?day=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".scripture")).toBeVisible();
    // A quiet period: prefetch is scheduled 500ms after the fonts settle, so
    // wait it out to prove that nothing is requested while they are held.
    await page.waitForTimeout(650);
    expect(requests.filter((url) => url.includes("/readings/"))).toEqual([
      "/readings/1.json",
    ]);
    expect(requests.some((url) => url.includes("church-logo-192"))).toBe(false);
    const prefetched = page.waitForResponse("**/readings/2.json*");
    fonts.open();
    await ready(page);
    await (await prefetched).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const loadingFlash = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const article = document.querySelector("article")!;
          let loading = false;
          const observer = new MutationObserver(() => {
            loading ||= !!article.querySelector(".loading-state");
            if (
              article.getAttribute("data-day") === "2" &&
              article.querySelector(".scripture")
            ) {
              observer.disconnect();
              resolve(loading);
            }
          });
          observer.observe(article, {
            childList: true,
            subtree: true,
            attributes: true,
          });
          document.querySelector<HTMLButtonElement>(".next-day")!.click();
        }),
    );
    expect(loadingFlash).toBe(false);
    expect(requests.filter((url) => url === "/readings/2.json")).toHaveLength(
      1,
    );
    await expect(page.locator(".reader h2").first()).toContainText(
      planDay(2).passages[0].book,
    );
  });

  test("speculative failures stay silent and foreground navigation retries", async ({
    page,
  }) => {
    let attempts = 0;
    await page.route("**/readings/2.json*", (route) =>
      ++attempts === 1
        ? route.fulfill({ status: 503, body: "failed" })
        : route.continue(),
    );
    const failed = page.waitForResponse("**/readings/2.json*");
    await page.goto("/?day=1");
    await ready(page);
    await (await failed).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    await nextDay(page).click();
    await ready(page);
    await expect(page.getByRole("article")).toHaveAttribute("data-day", "2");
    expect(attempts).toBe(2);
  });

  test("data saving and slow connections suppress speculative reads", async ({
    page,
  }) => {
    for (const connection of [
      { saveData: true, effectiveType: "4g" },
      { effectiveType: "2g" },
      { effectiveType: "3g" },
    ]) {
      await stubConnection(page, connection);
      // Each connection is a first visit: forget the place the last one opened.
      if (page.url().startsWith("http"))
        await page.evaluate((key) => localStorage.removeItem(key), STATE_KEY);
      const requests = readingRequests(page);
      await page.goto("/?day=1");
      await ready(page);
      // A quiet period: allowed prefetch would fire 500ms after the fonts settle.
      await page.waitForTimeout(700);
      expect(requests).toEqual(["/readings/1.json"]);
      await nextDay(page).click();
      await ready(page);
      await expect(page.getByRole("article")).toHaveAttribute("data-day", "2");
    }
  });

  test("leaving reading cancels queued prefetch", async ({ page }) => {
    const requests = readingRequests(page);
    const fonts = await blockFonts(page);
    await page.goto("/?day=1", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".scripture")).toBeVisible();
    await openPlanCalendar(page);
    await expect(page.locator(".calendar-day")).toHaveCount(30);
    fonts.open();
    await page.evaluate(() => document.fonts.ready);
    // A quiet period: the cancelled prefetch would have fired 500ms later.
    await page.waitForTimeout(700);
    expect(requests).toEqual(["/readings/1.json", "/readings/plan.json"]);
  });
});
