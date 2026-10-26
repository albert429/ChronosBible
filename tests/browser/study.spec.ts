import { test, expect, type Page } from "@playwright/test";
import {
  closeSheet,
  expectAccessible,
  longPress,
  noOverflow,
  openSection,
  ready,
  recordRequests,
  section,
  seed,
  study,
  stubConnection,
  tap,
  textPoint,
  verse,
} from "./helpers";

// The seeded reader is on day 10 (Matthew 8:14 onward).
const studyRequests = (page: Page) =>
  recordRequests(
    page,
    (pathname) => pathname.startsWith("/study/") || /StudyPanel/.test(pathname),
  );
/** Collapsed sections are available without fetching study data. */
async function sectionsReady(page: Page) {
  await expect(section(page, "الكلمات اليونانية")).toBeVisible();
}

test("tapping a verse opens its study sheet and only then loads study data", async ({
  page,
}) => {
  await seed(page);
  const requests = studyRequests(page);
  await page.goto("/");
  await ready(page);
  await page.waitForLoadState("networkidle");
  expect(requests).toEqual([]);

  await tap(page, 1);
  await expect(study(page)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "متى ⁦٨: ١٥⁩" })).toBeVisible();
  await expect(verse(page, 1)).toHaveAttribute("data-selected", "");
  // Every section starts collapsed, Greek last, without fetching study data.
  await expect(study(page).locator(".study-section-title")).toHaveText([
    "ترجمات أخرى",
    "الكلمات اليونانية",
  ]);
  for (const title of ["ترجمات أخرى", "الكلمات اليونانية"])
    await expect(section(page, title)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  await expect(section(page, "الكلمات اليونانية")).toHaveAccessibleName(
    /^الكلمات اليونانية$/,
  );
  await expect(section(page, "الكلمات اليونانية")).toHaveAccessibleDescription(
    "الكلمة العربية ومقابلها في الأصل",
  );
  await page.waitForLoadState("networkidle");
  expect(requests.filter((r) => r.startsWith("/study/"))).toEqual([]);

  await openSection(page, "الكلمات اليونانية");
  await expect(section(page, "الكلمات اليونانية")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(study(page).locator(".greek-row").first()).toBeVisible();
  const greek = study(page).locator('bdi[lang="grc"]').first();
  expect(await greek.evaluate((el) => getComputedStyle(el).direction)).toBe(
    "ltr",
  );
  await expect(study(page).locator(".greek-ar").first()).not.toHaveText("—");
  // Arabic, Greek and English share one line; the transliteration sits below.
  const firstRow = study(page).locator(".greek-main").first();
  await expect(firstRow.locator('bdi[lang="en"]')).toHaveText(/[a-z]/i);
  // Key words remain filtered; compact Strong’s identifiers accompany them.
  const words = await study(page).locator(".greek-word").allTextContents();
  expect(new Set(words).size).toBe(words.length);
  await expect(study(page).locator(".greek-meta").first()).toContainText(/G\d/);

  await closeSheet(page);
  await expect(verse(page, 1)).not.toHaveAttribute("data-selected");
  await expect(verse(page, 1).locator(".verse-number")).toBeFocused();
});

test("selecting, long-pressing or dragging over Scripture opens nothing", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/");
  await ready(page);
  await verse(page, 2).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await tap(page, 2);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  const { x, y } = await textPoint(page, 3);
  await longPress(page, { x, y });
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await page.evaluate(() => getSelection()!.removeAllRanges());
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // The same point does open on a plain tap, so the checks above are meaningful.
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await tap(page, 3);
  await expect(study(page)).toBeVisible();
});

test("keyboard users open a verse from its number and return to it", async ({
  page,
  browserName,
}) => {
  await seed(page);
  await page.goto("/");
  await ready(page);
  const first = page
    .getByRole("button", { name: "تفاصيل الآية ١٤", exact: true })
    .first();
  // macOS WebKit uses Option-Tab to visit all clickable items by default.
  for (
    let i = 0;
    i < 30 && !(await first.evaluate((el) => el === document.activeElement));
    i++
  )
    await page.keyboard.press(
      process.platform === "darwin" && browserName === "webkit"
        ? "Alt+Tab"
        : "Tab",
    );
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "متى ⁦٨: ١٤⁩" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(first).toBeFocused();
});

test("the study sheet is accessible in both themes and fits 320px at 38px text", async ({
  page,
}) => {
  await seed(page);
  await page.addInitScript(() => localStorage.setItem("word-font", "38"));
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  await ready(page);
  for (const dark of [false, true]) {
    await page.evaluate((dark) => {
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    }, dark);
    await tap(page, 1);
    // Everything expanded: the worst case for width and contrast.
    await openSection(page, "ترجمات أخرى");
    await expect(study(page).locator(".study-english")).toBeVisible();
    // A reader taps the Greek heading at the bottom edge of the sheet; its
    // content, which opens below the fold, scrolls into view.
    await section(page, "الكلمات اليونانية").evaluate((el) =>
      el.scrollIntoView({ block: "end" }),
    );
    await openSection(page, "الكلمات اليونانية");
    await expect(study(page).locator(".greek-row").first()).toBeInViewport();
    await expect(section(page, "الكلمات اليونانية")).toBeInViewport();
    await noOverflow(page);
    await expectAccessible(page, { include: "dialog[open]", wcag: true });
    await closeSheet(page);
  }
});

test("other translations load only when opened and include the KJV", async ({
  page,
}) => {
  await seed(page);
  const requests = studyRequests(page);
  await page.goto("/");
  await ready(page);
  await tap(page, 1);
  await sectionsReady(page);
  await page.waitForLoadState("networkidle");
  expect(requests.filter((r) => r.startsWith("/study/"))).toEqual([]);

  await openSection(page, "ترجمات أخرى");
  const english = study(page).locator(".study-english");
  await expect(english).toHaveText(
    "And he touched her hand, and the fever left her: and she arose, and ministered unto them.",
  );
  await expect(english).toHaveAttribute("lang", "en");
  await expect(
    study(page).getByText("كتاب الحياة", { exact: true }),
  ).toBeVisible();
  expect(
    requests.filter((r) => /\/study\/v2\/MAT\/8\/.*\.tr\.json$/.test(r)),
  ).toHaveLength(1);
});

test("a failed study request offers a retry that recovers", async ({
  page,
}) => {
  await seed(page);
  let fail = true;
  await page.route("**/study/v2/MAT/8/*.words.json.gz", (route) =>
    fail ? route.fulfill({ status: 503, body: "down" }) : route.fallback(),
  );
  await page.goto("/");
  await ready(page);
  await tap(page, 0);
  await openSection(page, "الكلمات اليونانية");
  const retry = study(page).getByRole("button", { name: "إعادة المحاولة" });
  await expect(retry).toBeVisible();
  fail = false;
  await retry.click();
  await expect(study(page).locator(".greek-row").first()).toBeVisible();
});

test("Save-Data skips warming the study chunk; the default build has no AI row", async ({
  page,
}) => {
  await seed(page);
  await stubConnection(page, { saveData: true, effectiveType: "4g" });
  const requests = studyRequests(page);
  await page.goto("/");
  await ready(page);
  const { x, y } = await textPoint(page, 3);
  await longPress(page, { x, y });
  await page.waitForLoadState("networkidle");
  expect(requests).toEqual([]);

  await tap(page, 1);
  await sectionsReady(page);
  await expect(study(page).getByText("اسأل الذكاء الاصطناعي")).toHaveCount(0);
  await closeSheet(page);
  const first = await verse(page, 0).boundingBox();
  expect(first!.y).toBeLessThanOrEqual(200);
});
