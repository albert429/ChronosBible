import { test, expect, type Page } from "@playwright/test";
import {
  MODES,
  chooseFromMenu,
  closeSheet,
  expectAccessible,
  openAppearance,
  ready,
  recordRequests,
} from "./helpers";
import { routeChapterAudio } from "./chapterAudio";

const LABEL = "إظهار التشكيل";
const KEY = "word-diacritics";
// Written independently of the app: the marks that must disappear.
const MARKS = new RegExp("[\\u064B-\\u0652\\u0670]");
const ALL_MARKS = new RegExp(MARKS, "g");
const HAMZA = new RegExp("آ|أ|إ|ؤ|ئ|\\u0653|\\u0654|\\u0655", "g");

const checkbox = (page: Page) =>
  page.getByRole("dialog").getByRole("checkbox", { name: LABEL });
async function setShown(page: Page, shown: boolean) {
  await openAppearance(page);
  await checkbox(page).setChecked(shown);
  await closeSheet(page);
}
/** Everything displayed as Scripture, plus the structure around it. */
const snapshot = (page: Page) =>
  page.locator(".scripture").evaluate((root) => ({
    text: root.textContent ?? "",
    headings: [...root.querySelectorAll("h2, h3, .scripture-inline-note")].map(
      (el) => el.textContent ?? "",
    ),
    notes: [...root.querySelectorAll("p")].map((el) => el.textContent ?? ""),
    verses: [...root.querySelectorAll(".verse")].map((el) =>
      el.getAttribute("data-v"),
    ),
    numbers: [...root.querySelectorAll(".verse sup button")].map(
      (el) => el.getAttribute("aria-label") + el.textContent,
    ),
    breaks: root.querySelectorAll(".scripture-break").length,
    inline: root.querySelectorAll(".scripture-inline-note").length,
    html: root.innerHTML,
  }));

test.describe("إظهار التشكيل", () => {
  test("is on by default, saved on the device, and survives a reload", async ({
    page,
  }) => {
    await page.goto("/?mode=bible&book=GEN&chapter=1");
    await ready(page);
    expect((await snapshot(page)).text).toMatch(MARKS);
    await openAppearance(page);
    await expect(checkbox(page)).toBeChecked();
    await expect(checkbox(page)).toHaveCSS("width", "22px");
    await checkbox(page).uncheck();
    await closeSheet(page);
    expect((await snapshot(page)).text).not.toMatch(MARKS);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(
      "false",
    );
    await page.reload();
    await ready(page);
    expect((await snapshot(page)).text).not.toMatch(MARKS);
    await openAppearance(page);
    await expect(checkbox(page)).not.toBeChecked();
    // The other controls are untouched.
    const settings = page.getByRole("dialog", { name: "إعدادات القراءة" });
    await expect(
      settings.getByRole("checkbox", { name: "استماع متواصل للإصحاحات" }),
    ).toBeVisible();
    await expect(
      settings.getByRole("button", { name: "تكبير الخط" }),
    ).toBeEnabled();
    await settings.getByRole("button", { name: "الوضع الليلي" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await checkbox(page).check();
    await closeSheet(page);
    expect((await snapshot(page)).text).toMatch(MARKS);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(
      "true",
    );
  });

  test("is keyboard operable and accessible", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await openAppearance(page);
    await checkbox(page).focus();
    await expect(checkbox(page)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(checkbox(page)).not.toBeChecked();
    expect((await checkbox(page).boundingBox())!.height).toBeGreaterThanOrEqual(
      22,
    );
    const row = page.locator(".continuous-option", { hasText: LABEL });
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectAccessible(page, { wcag: true });
  });

  test("keeps the other preferences when storage fails", async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("word-font")) {
        localStorage.setItem("word-font", "34");
        localStorage.setItem("word-dark", "true");
      }
      Storage.prototype.setItem = () => {
        throw new DOMException("full", "QuotaExceededError");
      };
    });
    await page.goto("/?mode=bible&book=GEN&chapter=1");
    await ready(page);
    await setShown(page, false);
    expect((await snapshot(page)).text).not.toMatch(MARKS);
    expect(
      await page.evaluate(() => [
        localStorage.getItem("word-font"),
        localStorage.getItem("word-dark"),
        localStorage.getItem("word-diacritics"),
      ]),
    ).toEqual(["34", "true", null]);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("hides only vowel marks, in all four modes, leaving structure intact", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("word-font", "22"));
    await page.goto("/?mode=bible&book=PSA&chapter=23");
    await ready(page);
    const targets: [string, () => Promise<void>][] = [
      ["bible", async () => {}],
      ["psalm", async () => {}],
      ["ot", () => chooseFromMenu(page, MODES.ot)],
      ["nt", () => chooseFromMenu(page, MODES.nt)],
      ["plan", () => chooseFromMenu(page, MODES.plan)],
    ];
    for (const [name, go] of targets) {
      await go();
      await ready(page);
      await setShown(page, true);
      const on = await snapshot(page);
      expect(on.text, name).toMatch(MARKS);
      expect(on.verses.length, name).toBeGreaterThan(0);
      await setShown(page, false);
      const off = await snapshot(page);
      expect(off.text, name).not.toMatch(MARKS);
      expect(off.headings.join(""), name).not.toMatch(MARKS);
      expect(off.notes.join(""), name).not.toMatch(MARKS);
      // Same structure, same verse anchors, same verse-number buttons.
      expect(off.verses, name).toEqual(on.verses);
      expect(off.numbers, name).toEqual(on.numbers);
      expect(off.breaks, name).toBe(on.breaks);
      expect(off.inline, name).toBe(on.inline);
      // Exactly the marks are gone: nothing else was normalised.
      expect(off.text, name).toBe(on.text.replace(ALL_MARKS, ""));
      expect(off.html, name).toBe(on.html.replace(ALL_MARKS, ""));
      expect(off.text.match(HAMZA) ?? [], name).toEqual(
        on.text.match(HAMZA) ?? [],
      );
      await setShown(page, true);
      expect((await snapshot(page)).text, name).toBe(on.text);
    }
  });

  test("inline notes and headings are stripped without moving offsets", async ({
    page,
  }) => {
    // Chapters with notes inside verses: compare note placement both ways.
    for (const [book, chapter] of [
      ["PSA", 3],
      ["ISA", 53],
      ["MAT", 5],
    ]) {
      await page.goto(`/?mode=bible&book=${book}&chapter=${chapter}`);
      await ready(page);
      await setShown(page, true);
      const on = await page
        .locator(".verse")
        .evaluateAll((els) =>
          els.map((el) => [
            el.getAttribute("data-v"),
            [...el.childNodes].map((n) =>
              n.nodeType === 3 ? "t" : (n as Element).className || "e",
            ),
          ]),
        );
      await setShown(page, false);
      const off = await page
        .locator(".verse")
        .evaluateAll((els) =>
          els.map((el) => [
            el.getAttribute("data-v"),
            [...el.childNodes].map((n) =>
              n.nodeType === 3 ? "t" : (n as Element).className || "e",
            ),
          ]),
        );
      expect(off, `${book} ${chapter}`).toEqual(on);
      await setShown(page, true);
    }
  });

  test("study taps and highlighting still work on stripped text", async ({
    page,
  }) => {
    await page.goto("/?mode=bible&book=JHN&chapter=3&verse=16");
    await ready(page);
    await setShown(page, false);
    await expect(page.locator('.verse[data-v="16"]')).toBeVisible();
    await page.locator('.verse[data-v="16"] .verse-number').click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("never reads audio before Listen, and audio starts with marks hidden", async ({
    page,
  }) => {
    test.skip(
      process.env.AUDIO_TEST_FIXTURES !== "1",
      "Needs the audio fixture build",
    );
    await routeChapterAudio(page, { "GEN:1": { duration: 30 } });
    const requests = recordRequests(page, (path) => path.includes("/audio/"));
    await page.goto("/?mode=bible&book=GEN&chapter=1");
    await ready(page);
    await setShown(page, false);
    await page.waitForTimeout(500);
    expect(requests).toEqual([]);
    await page
      .getByRole("button", { name: "استمع إلى الإصحاح", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .locator("audio")
          .evaluate((el: HTMLAudioElement) => el.currentTime),
      )
      .toBeGreaterThan(0);
    expect(requests.some((path) => path.endsWith("/GEN/1.json"))).toBe(true);
  });
});
