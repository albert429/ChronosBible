import { test, expect, type Page } from "@playwright/test";
import {
  MODES,
  article,
  chooseFromMenu,
  closeSheet,
  completeButton,
  createGate,
  expectAccessible,
  menuButton,
  menuDialog,
  noOverflow,
  ready,
  recordRequests,
  storedState,
  stubConnection,
  tabKey,
  undoButton,
} from "./helpers";
import { LONG_TITLE, stubChronology } from "./chronology";

const contentsButton = (page: Page) =>
  page.getByRole("button", {
    name: /^فهرس العهد (القديم|الجديد) بالترتيب الزمني:/,
  });
const contents = (page: Page, testament: "القديم" | "الجديد" = "القديم") =>
  page.getByRole("dialog", {
    name: `العهد ${testament} بالترتيب الزمني`,
    exact: true,
  });
const previousReading = (page: Page) =>
  page.getByRole("button", { name: "القراءة السابقة", exact: true });
const nextReading = (page: Page) =>
  page.getByRole("button", { name: "القراءة التالية", exact: true });
const search = (page: Page) => new URL(page.url()).search;
const reading = (testament: "OT" | "NT", id: string) =>
  `chrono:${testament}:${id}`;

test.beforeEach(async ({ page }) => {
  await stubConnection(page, { saveData: true });
});

test("a chronology opens on its first reading and moves reading by reading with shareable links", async ({
  page,
}) => {
  await stubChronology(page);
  const audio = recordRequests(page, (path) => path.startsWith("/audio/"));
  await page.goto("/");
  await ready(page);
  await chooseFromMenu(page, MODES.ot);
  await ready(page);
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("OT", "gen-1-1"),
  );
  await expect(article(page)).toHaveAccessibleName("الخلق");
  expect(search(page)).toBe("?mode=chronological&testament=OT&reading=gen-1-1");
  const trigger = contentsButton(page);
  await expect(trigger).toHaveAccessibleName(
    "فهرس العهد القديم بالترتيب الزمني: الخلق",
  );
  await expect(trigger).toContainText("زمني · العهد القديم");
  await expect(previousReading(page)).toBeDisabled();
  // RTL: "previous" sits on the right, "next" on the left.
  const previous = (await previousReading(page).boundingBox())!;
  const next = (await nextReading(page).boundingBox())!;
  expect(previous.x).toBeGreaterThan(next.x);
  // gen-1-1 has a published recording: Listen is offered, and nothing is
  // fetched until it is clicked (the test never clicks it).
  await expect(page.locator(".listen-button")).toBeVisible();
  await expect(page.locator(".audio-unavailable")).toHaveCount(0);
  expect(audio).toEqual([]);
  await nextReading(page).click();
  await ready(page);
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("OT", "gen-2-1"),
  );
  expect(await page.evaluate(() => scrollY)).toBe(0);
  // gen-2-1 has no published recording: say so and fetch nothing.
  await expect(page.locator(".audio-unavailable")).toHaveText(
    "التسجيل الصوتي غير متاح لهذه القراءة حاليًا.",
  );
  await expect(page.locator(".listen-button")).toHaveCount(0);
  for (let i = 0; i < 3; i++) await nextReading(page).click();
  await ready(page);
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("OT", "job-1-1"),
  );
  await expect(nextReading(page)).toBeDisabled();
  await page.reload();
  await ready(page);
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("OT", "job-1-1"),
  );
  await page.goBack();
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("OT", "gen-12-1"),
  );
  await previousReading(page).click();
  await ready(page);
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("OT", "gen-3-1"),
  );
  expect(audio).toEqual([]);
});

test("the contents sheet groups stages and substages with durations and progress only inside it", async ({
  page,
}) => {
  await stubChronology(page);
  await page.goto("/?mode=chronological&testament=NT&reading=mat-5-1");
  await ready(page);
  // Self-paced: no dates or durations on the reading page.
  await expect(page.locator("main")).not.toContainText("دقائق");
  await expect(page.locator("main")).not.toContainText("دقيقة");
  const trigger = contentsButton(page);
  await trigger.click();
  const sheet = contents(page, "الجديد");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("القراءات المكتملة: ٠ من ٣");
  await expect(sheet.getByRole("progressbar")).toHaveAttribute(
    "aria-valuemax",
    "3",
  );
  const life = sheet.getByRole("button", { name: /^حياة يسوع وخدمته/ });
  const church = sheet.getByRole("button", { name: /^بداية الكنيسة/ });
  // The current reading's stage opens; the others stay folded.
  await expect(life).toHaveAttribute("aria-expanded", "true");
  await expect(church).toHaveAttribute("aria-expanded", "false");
  await expect(life).toContainText("٠ من ٢ · نحو ١٢ دقيقة");
  await expect(
    sheet.getByRole("heading", { name: "الميلاد والبداية" }),
  ).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "الخدمة" })).toBeVisible();
  const current = sheet.getByRole("button", {
    name: "الموعظة على الجبل، ٨ دقائق",
    exact: true,
  });
  await expect(current).toHaveAttribute("aria-current", "page");
  // No dates anywhere in a self-paced chronology.
  expect(await sheet.textContent()).not.toMatch(
    /يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر|السبت|الأحد|الاثنين/,
  );
  await church.click();
  await expect(church).toHaveAttribute("aria-expanded", "true");
  await expect(
    sheet.getByRole("button", { name: "صعود المسيح، ٥ دقائق", exact: true }),
  ).toBeVisible();
  await life.click();
  await expect(current).toHaveCount(0);
  await expectAccessible(page, { wcag: true });
  await noOverflow(page);
  await sheet
    .getByRole("button", { name: "صعود المسيح، ٥ دقائق", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await ready(page);
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("NT", "act-1-1"),
  );
  // As with the chapter picker, focus moves to the newly opened reading.
  await expect(page.locator("main")).toBeFocused();
});

test("completion is explicit per mode, undoable, and never carried to another mode", async ({
  page,
}) => {
  await stubChronology(page);
  await page.goto("/?mode=chronological&testament=OT&reading=gen-1-1");
  await ready(page);
  const guest = async () => (await storedState(page)).guest.completion;
  expect((await guest())["chrono:OT"]).toEqual([]);
  await completeButton(page).click();
  await expect(page.getByText("تمت هذه القراءة")).toBeVisible();
  await expect(undoButton(page)).toBeVisible();
  expect(await guest()).toEqual({
    bible: [],
    plan: [],
    "chrono:OT": ["gen-1-1"],
    "chrono:NT": [],
  });
  await contentsButton(page).click();
  const sheet = contents(page);
  await expect(sheet).toContainText("القراءات المكتملة: ١ من ٥");
  await expect(
    sheet.getByRole("button", { name: "الخلق، ٦ دقائق، مكتملة", exact: true }),
  ).toBeVisible();
  // Continue reading leads to the first unfinished reading from here on.
  await sheet.getByRole("button", { name: "متابعة القراءة" }).click();
  await ready(page);
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("OT", "gen-2-1"),
  );
  await expect(completeButton(page)).toBeVisible();
  // The same chapter in the canonical Bible is a separate record.
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  await expect(completeButton(page)).toBeVisible();
  await page.goto("/?mode=chronological&testament=OT&reading=gen-1-1");
  await ready(page);
  await undoButton(page).click();
  await expect(completeButton(page)).toBeVisible();
  expect((await guest())["chrono:OT"]).toEqual([]);
  await page.reload();
  await ready(page);
  await expect(completeButton(page)).toBeVisible();
});

test("every mode keeps its own place; a shared link wins and an unknown reading falls back", async ({
  page,
}) => {
  await stubChronology(page);
  await page.goto("/?mode=chronological&testament=OT&reading=gen-3-1");
  await ready(page);
  await chooseFromMenu(page, MODES.nt);
  await ready(page);
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("NT", "luk-1-1"),
  );
  await nextReading(page).click();
  await ready(page);
  await chooseFromMenu(page, MODES.bible);
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:1");
  await chooseFromMenu(page, MODES.plan);
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-day", "1");
  for (const [mode, identity] of [
    [MODES.ot, reading("OT", "gen-3-1")],
    [MODES.nt, reading("NT", "mat-5-1")],
    [MODES.bible, "bible:GEN:1"],
    [MODES.plan, "plan:1"],
  ]) {
    await chooseFromMenu(page, mode);
    await ready(page);
    await expect(article(page)).toHaveAttribute("data-reading", identity);
  }
  // The menu marks the current mode.
  await menuButton(page).click();
  await expect(
    menuDialog(page).getByRole("button", { name: MODES.plan, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await closeSheet(page);
  // A launch returns to the last mode; an explicit link wins over it.
  await page.goto("/");
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-reading", "plan:1");
  await page.goto("/?mode=chronological&testament=OT&reading=job-1-1");
  await ready(page);
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("OT", "job-1-1"),
  );
  expect((await storedState(page)).guest.places["chrono:OT"]).toEqual({
    mode: "chronological",
    testament: "OT",
    readingId: "job-1-1",
  });
  // A reading the catalog does not have opens the chronology's first one.
  await page.goto("/?mode=chronological&testament=NT&reading=no-such-reading");
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("NT", "luk-1-1"),
  );
  await ready(page);
  expect(search(page)).toBe("?mode=chronological&testament=NT&reading=luk-1-1");
});

test("an older chronology choice still loading never overrides a later choice", async ({
  page,
}) => {
  // Later routes run first and fall back to the fixture.
  await stubChronology(page);
  const gate = createGate();
  await page.route("**/chronology/OT.json*", async (route) => {
    await gate.opened;
    await route.fallback();
  });
  await page.goto("/?day=1");
  await ready(page);
  const requested = page.waitForRequest("**/chronology/OT.json*");
  await chooseFromMenu(page, MODES.ot);
  await requested;
  // The catalog is still pending: the plan day stays on screen.
  await expect(article(page)).toHaveAttribute("data-reading", "plan:1");
  await chooseFromMenu(page, MODES.bible);
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:1");
  const response = page.waitForResponse("**/chronology/OT.json*");
  gate.open();
  await response;
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:1");
  expect(search(page)).toBe("?mode=bible&book=GEN&chapter=1");
  // Choosing it again now opens it.
  await chooseFromMenu(page, MODES.ot);
  await ready(page);
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("OT", "gen-1-1"),
  );
});

test("a catalog failure is reported without leaving the current reading", async ({
  page,
}) => {
  await stubChronology(page);
  let fail = true;
  await page.route("**/chronology/NT.json*", (route) =>
    fail ? route.fulfill({ status: 503, body: "down" }) : route.fallback(),
  );
  await page.goto("/");
  await ready(page);
  await chooseFromMenu(page, MODES.nt);
  await expect(page.getByRole("alert")).toContainText("تعذر تحميل فهرس");
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:1");
  fail = false;
  await chooseFromMenu(page, MODES.nt);
  await ready(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(article(page)).toHaveAttribute(
    "data-reading",
    reading("NT", "luk-1-1"),
  );
});

test("chronological passages keep headings, titles, verse ids and exact text; study uses each passage's chapter", async ({
  page,
}) => {
  await stubChronology(page);
  await page.goto("/?mode=chronological&testament=OT&reading=gen-12-1");
  await ready(page);
  await expect(contentsButton(page)).toHaveAccessibleName(
    `فهرس العهد القديم بالترتيب الزمني: ${LONG_TITLE}`,
  );
  await expect(page.locator(".passage")).toHaveCount(2);
  await expect(page.locator(".passage h2").nth(1)).toContainText("المزامير");
  // Psalm 3's title stays a title, outside verse 1.
  const title = page.locator("#passage-1 .scripture-superscription");
  await expect(title).toBeVisible();
  const psalm = await page.evaluate(() =>
    fetch("/bible/PSA/3.json").then((r) => r.json()),
  );
  expect(
    await page.locator('#passage-1 .verse[data-v="1"]').textContent(),
  ).not.toContain(await title.textContent());
  // Every verse renders its canonical text with all diacritics.
  const verses = await page
    .locator("#passage-1 .verse")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        number: Number((element as HTMLElement).dataset.v),
        text: (() => {
          const copy = element.cloneNode(true) as HTMLElement;
          copy.querySelector("sup")?.remove();
          return copy.textContent!.trim();
        })(),
      })),
    );
  expect(verses).toEqual(
    psalm.passages[0].verses.map((v: { number: number; text: string }) => ({
      number: v.number,
      text: v.text.trim(),
    })),
  );
  await expect(page.locator("#passage-0 h3").first()).toBeVisible();
  // A verse link resolves to the passage holding that verse number.
  await page.goto("/?mode=chronological&testament=NT&reading=luk-1-1&verse=14");
  await ready(page);
  const target = page.locator('#passage-1 .verse[data-v="14"]');
  await expect(target.locator("button")).toBeFocused();
  const box = (await target.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(60);
  await expect(target).toBeInViewport();
  await target.locator("button").press("Enter");
  const study = page.getByRole("dialog", { name: "يوحنا ⁦١: ١٤⁩" });
  await expect(study).toBeVisible();
  await expect(
    study.getByRole("button", { name: /^الكلمات اليونانية/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(target.locator("button")).toBeFocused();
});

test("the contents sheet works from the keyboard and scrolls internally on small phones", async ({
  page,
  browserName,
}) => {
  await stubChronology(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/?mode=chronological&testament=OT&reading=job-1-1");
  await ready(page);
  const trigger = contentsButton(page);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const sheet = contents(page);
  await expect(
    sheet.getByRole("button", { name: "إغلاق النافذة" }),
  ).toBeFocused();
  const current = sheet.locator('[aria-current="page"]');
  await expect(current).toBeInViewport();
  const body = sheet.locator(".sheet-body");
  expect(
    await body.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);
  await page.keyboard.press(tabKey(browserName));
  await expect(
    sheet.getByRole("button", { name: "متابعة القراءة" }),
  ).toBeFocused();
  await page.keyboard.press(tabKey(browserName));
  const first = sheet.getByRole("button", { name: /^البدايات/ });
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await noOverflow(page);
});
