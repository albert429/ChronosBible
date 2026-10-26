import { test, expect, type Page } from "@playwright/test";
import {
  MODES,
  chooseFromMenu,
  completeButton,
  storedState,
  closeSheet,
  createGate,
  expectAccessible,
  noOverflow,
  openAppearance,
  ready,
  recordRequests,
  seed,
  stubConnection,
} from "./helpers";

const chapterButton = (page: Page) =>
  page.getByRole("button", { name: /^اختيار السفر والإصحاح:/ });
async function chooseChapter(
  page: Page,
  book: string,
  chapter: string,
  testament: "OT" | "NT" = "OT",
) {
  await chapterButton(page).click();
  const sheet = page.getByRole("dialog", {
    name: "الكتاب المقدس",
    exact: true,
  });
  await sheet
    .getByRole("button", {
      name: testament === "OT" ? "العهد القديم" : "العهد الجديد",
      exact: true,
    })
    .click();
  await sheet.getByRole("combobox", { name: "السفر" }).selectOption(book);
  await sheet.getByRole("button", { name: chapter, exact: true }).click();
  await ready(page);
}

test("Bible menu mode opens 66 books and preserves plan progress and last locations", async ({
  page,
}) => {
  await seed(page);
  await stubConnection(page, { saveData: true });
  const requests = recordRequests(page, (path) =>
    /^\/(bible|readings|audio)\//.test(path),
  );
  await page.goto("/");
  await ready(page);
  const completion = async () =>
    (await storedState(page)).profiles.map(
      (reader: { completion: unknown }) => reader.completion,
    );
  const progress = await completion();
  expect(requests).toEqual(["/readings/10.json"]);
  await chooseFromMenu(page, MODES.bible);
  await ready(page);
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "bible:GEN:1",
  );
  await expect(page.getByRole("article")).not.toHaveAttribute("data-day");
  // Each chapter has its own explicit completion; opening one records nothing.
  await expect(completeButton(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "الإصحاح السابق", exact: true }),
  ).toBeDisabled();
  await chapterButton(page).click();
  const sheet = page.getByRole("dialog", {
    name: "الكتاب المقدس",
    exact: true,
  });
  await expect(sheet.locator("option")).toHaveCount(39);
  await sheet
    .getByRole("button", { name: "العهد الجديد", exact: true })
    .click();
  await expect(sheet.locator("option")).toHaveCount(27);
  await sheet.getByRole("combobox", { name: "السفر" }).selectOption("JHN");
  await sheet.getByRole("button", { name: "يوحنا ٣", exact: true }).click();
  await ready(page);
  await chooseFromMenu(page, MODES.plan);
  await ready(page);
  await expect(page.getByRole("article")).toHaveAttribute("data-day", "10");
  await chooseFromMenu(page, MODES.bible);
  await ready(page);
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "bible:JHN:3",
  );
  await page.goto("/");
  await ready(page);
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "bible:JHN:3",
  );
  expect(await completion()).toEqual(progress);
  expect(requests.filter((path) => path.startsWith("/audio/"))).toEqual([]);
});

test("chapter arrows cross book boundaries and stop at Revelation 22", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  await page.goto("/?mode=bible&book=GEN&chapter=50");
  await ready(page);
  await page
    .getByRole("button", { name: "الإصحاح التالي", exact: true })
    .click();
  await ready(page);
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "bible:EXO:1",
  );
  await page
    .getByRole("button", { name: "الإصحاح السابق", exact: true })
    .click();
  await ready(page);
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "bible:GEN:50",
  );
  await chooseChapter(page, "REV", "رؤيا يوحنا ٢٢", "NT");
  await expect(
    page.getByRole("button", { name: "الإصحاح التالي", exact: true }),
  ).toBeDisabled();
});

test("canonical links jump below the sticky header and Back/Forward restore identities", async ({
  page,
}) => {
  await page.goto("/?day=17");
  await ready(page);
  await expect(page.getByRole("article")).toHaveAttribute("data-day", "17");
  await chooseFromMenu(page, MODES.bible);
  await ready(page);
  await chooseChapter(page, "JHN", "يوحنا ٣", "NT");
  await page
    .getByRole("button", { name: "الإصحاح التالي", exact: true })
    .click();
  await ready(page);
  await page.goBack();
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "bible:JHN:3",
  );
  await page.goBack();
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "bible:GEN:1",
  );
  await page.goBack();
  await expect(page.getByRole("article")).toHaveAttribute("data-day", "17");
  await page.goForward();
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "bible:GEN:1",
  );
  await page.goto("/?mode=bible&book=JHN&chapter=3&verse=16");
  await ready(page);
  const verse = page.locator('.verse[data-v="16"]');
  await expect(verse.locator("button")).toBeFocused();
  const box = await verse.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(60);
  expect(box!.y).toBeLessThan(120);
  await page
    .getByRole("button", { name: "الإصحاح التالي", exact: true })
    .click();
  await ready(page);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("rapid chapter and mode changes ignore stale text; failed chapters retry", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  const gate = createGate();
  await page.route("**/bible/GEN/2.json*", async (route) => {
    await gate.opened;
    await route.continue();
  });
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  await page
    .getByRole("button", { name: "الإصحاح التالي", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveAttribute("aria-busy", "true");
  await page
    .getByRole("button", { name: "الإصحاح التالي", exact: true })
    .click();
  await ready(page);
  gate.open();
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "bible:GEN:3",
  );
  await expect(page.locator(".passage h2")).toHaveText(/التكوين.*٣/);
  await chooseFromMenu(page, MODES.plan);
  await ready(page);
  await expect(page.getByRole("article")).toHaveAttribute("data-day", "1");
  let fail = true;
  await page.route("**/bible/GEN/4.json*", (route) =>
    fail
      ? route.fulfill({ status: 503, body: "unavailable" })
      : route.continue(),
  );
  await chooseFromMenu(page, MODES.bible);
  await page
    .getByRole("button", { name: "الإصحاح التالي", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("تعذر تحميل الإصحاح");
  fail = false;
  await page
    .getByRole("button", { name: "إعادة المحاولة", exact: true })
    .click();
  await ready(page);
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "bible:GEN:4",
  );
});

test("canonical NT resolves real study data while OT presents no invented original language", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  const requests = recordRequests(
    page,
    (path) => path.startsWith("/study/") || path.endsWith("plan.json"),
  );
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  await expect(page.locator(".verse-text h3")).toContainText("البدء");
  await page.locator(".verse-number").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText(
    "لا تتوفر دراسة لهذه الآية حاليًا.",
  );
  await expect(
    page.getByRole("button", { name: /الكلمات اليونانية/ }),
  ).toHaveCount(0);
  expect(requests).toEqual([]);
  await closeSheet(page);
  await chooseChapter(page, "JHN", "يوحنا ١", "NT");
  await page.locator(".verse-number").first().focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: /^الكلمات اليونانية/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^ترجمات أخرى/ }),
  ).toBeVisible();
  expect(requests).toContain("/readings/plan.json");
  expect(requests.some((path) => /^\/study\/\d+\.json$/.test(path))).toBe(true);
  await closeSheet(page);
  await chooseChapter(page, "PSA", "المزامير ٣");
  await expect(page.locator(".scripture-superscription")).toBeVisible();
  const title = await page.locator(".scripture-superscription").textContent();
  expect(await page.locator(".verse").first().textContent()).not.toContain(
    title,
  );
});

test("Bible navigation and picker fit phones, dark maximum text and 200% reflow", async ({
  page,
}) => {
  await page.goto("/?mode=bible&book=2TH&chapter=1");
  await ready(page);
  const settings = await openAppearance(page);
  await settings
    .getByRole("button", { name: "الوضع الليلي", exact: true })
    .click();
  const increase = settings.getByRole("button", {
    name: "تكبير الخط",
    exact: true,
  });
  while (await increase.isEnabled()) await increase.click();
  await settings.getByRole("checkbox", { name: "استماع متواصل" }).check();
  await closeSheet(page);
  for (const width of [320, 360, 390, 430, 195]) {
    await page.setViewportSize({ width, height: width === 195 ? 422 : 844 });
    await noOverflow(page);
    expect((await page.locator(".topbar").boundingBox())!.height).toBe(60);
    const trigger = chapterButton(page);
    await trigger.click();
    const sheet = page.getByRole("dialog", {
      name: "الكتاب المقدس",
      exact: true,
    });
    const targets = await sheet
      .locator(".chapter-grid button")
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        })),
      );
    expect(
      targets.every((target) => target.width >= 44 && target.height >= 44),
    ).toBe(true);
    await noOverflow(page);
    if (width === 390) {
      await expectAccessible(page, { wcag: true });
      await page.screenshot({
        path: test.info().outputPath("bible-picker-dark.png"),
        scale: "css",
      });
    }
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    if (width === 195) await chooseChapter(page, "JHN", "يوحنا ٣", "NT");
  }
  await page.reload();
  await ready(page);
  const reloaded = await openAppearance(page);
  await expect(
    reloaded.getByRole("checkbox", { name: "استماع متواصل" }),
  ).toBeChecked();
});
