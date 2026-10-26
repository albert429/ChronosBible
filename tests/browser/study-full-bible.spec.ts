import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  closeSheet,
  expectAccessible,
  noOverflow,
  openSection,
  ready,
  recordRequests,
  section,
  study,
  stubConnection,
} from "./helpers";

async function openVerse(page: Page, verse = 1, passage = 0) {
  const trigger = page.locator(
    `#passage-${passage} .verse[data-v="${verse}"] .verse-number`,
  );
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(study(page)).toBeVisible();
}
async function expandWords(page: Page) {
  await study(page)
    .getByRole("button", { name: /^الكلمات / })
    .click();
  await expect(study(page).locator(".greek-row").first()).toBeVisible();
}
async function studyContents(page: Page) {
  await openSection(page, "ترجمات أخرى");
  await expect(study(page).locator(".study-english")).toBeVisible();
  await expandWords(page);
  return {
    translations: await study(page)
      .locator(".study-translation")
      .allTextContents(),
    words: await study(page).locator(".greek-row").allTextContents(),
  };
}

test("normal Bible and OT chronology show the same Genesis study with no initial study requests", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  const requests = recordRequests(page, (path) => path.startsWith("/study/"));
  let normal: Awaited<ReturnType<typeof studyContents>> | undefined;
  for (const url of [
    "/?mode=bible&book=GEN&chapter=1",
    "/?mode=chronological&testament=OT&reading=gen-1-1",
  ]) {
    requests.length = 0;
    await page.goto(url);
    await ready(page);
    await page.waitForLoadState("networkidle");
    expect(requests).toEqual([]);
    await openVerse(page);
    expect(requests).toEqual([]);
    const contents = await studyContents(page);
    if (normal) expect(contents).toEqual(normal);
    else normal = contents;
    await expect(section(page, "الكلمات العبرية")).toBeVisible();
    const hebrew = study(page).locator('bdi[lang="he"]').first();
    expect(await hebrew.evaluate((el) => getComputedStyle(el).direction)).toBe(
      "rtl",
    );
    expect(requests.every((path) => path.startsWith("/study/v2/GEN/1/"))).toBe(
      true,
    );
    await closeSheet(page);
  }
});

test("NT chronological passages and the 150-day plan use the selected book's study", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  const requests = recordRequests(page, (path) => path.startsWith("/study/"));
  await page.goto("/?mode=bible&book=LUK&chapter=1");
  await ready(page);
  await openVerse(page);
  const normal = await studyContents(page);
  await closeSheet(page);
  for (const [url, passage] of [
    ["/?day=1", 1],
    ["/?mode=chronological&testament=NT&reading=mrk-1-1", 1],
  ] as const) {
    requests.length = 0;
    await page.goto(url);
    await ready(page);
    await openVerse(page, 1, passage);
    expect(await studyContents(page)).toEqual(normal);
    expect(requests.every((path) => path.startsWith("/study/v2/LUK/1/"))).toBe(
      true,
    );
    await closeSheet(page);
  }
});

test("mixed and Aramaic verses retain their language labels and vowel marks", async ({
  page,
}) => {
  for (const [book, chapter, verse, label] of [
    ["DAN", 2, 4, "الكلمات العبرية والآرامية"],
    ["DAN", 2, 5, "الكلمات الآرامية"],
    ["EZR", 4, 8, "الكلمات الآرامية"],
  ] as const) {
    await page.goto(`/?mode=bible&book=${book}&chapter=${chapter}`);
    await ready(page);
    await openVerse(page, verse);
    await expandWords(page);
    await expect(section(page, label)).toBeVisible();
    const original = study(page).locator('bdi[lang="arc"]').first();
    await expect(original).toHaveAttribute("dir", "rtl");
    await expect(original).toHaveText(/[\u0591-\u05C7]/);
    await noOverflow(page);
    await closeSheet(page);
  }
});

test("translations work when words fail and retry restores words independently", async ({
  page,
}) => {
  let broken = true;
  await page.route("**/study/v2/GEN/1/*.words.json.gz", (route) =>
    broken ? route.fulfill({ status: 503, body: "down" }) : route.fallback(),
  );
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  await openVerse(page);
  await openSection(page, "الكلمات العبرية والآرامية");
  const retry = study(page).getByRole("button", { name: "إعادة المحاولة" });
  await expect(retry).toBeVisible();
  await openSection(page, "ترجمات أخرى");
  await expect(study(page).locator(".study-english")).toContainText(
    "In the beginning",
  );
  broken = false;
  await retry.click();
  await expect(study(page).locator('bdi[lang="he"]').first()).toBeVisible();
});

test("a browser without gzip decoding keeps translations available", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "DecompressionStream", {
      value: undefined,
      configurable: true,
    }),
  );
  // Vite may serve .gz with Content-Encoding, which the browser decodes itself.
  // Exercise a raw stored gzip response, as well as the host-decoded path above.
  await page.route("**/study/v2/GEN/1/*.words.json.gz", (route) =>
    route.fulfill({
      body: readFileSync(`public${new URL(route.request().url()).pathname}`),
      contentType: "application/gzip",
    }),
  );
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  await openVerse(page);
  await openSection(page, "الكلمات العبرية والآرامية");
  await expect(study(page)).toContainText(
    "يتطلب عرض الكلمات الأصلية تحديث المتصفح",
  );
  await openSection(page, "ترجمات أخرى");
  await expect(study(page).locator(".study-english")).toContainText(
    "In the beginning",
  );
});

test("a delayed previous verse cannot populate the next verse's sheet", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/study/v2/GEN/1/*.words.json.gz", async (route) => {
    await gate;
    await route.fallback();
  });
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  await openVerse(page, 1);
  await openSection(page, "الكلمات العبرية والآرامية");
  await closeSheet(page);
  await openVerse(page, 2);
  await openSection(page, "الكلمات العبرية والآرامية");
  release();
  await expect(study(page).locator(".greek-row").first()).toBeVisible();
  await expect(study(page)).toHaveAttribute("aria-labelledby", /./);
  await expect(study(page).locator(".study-verse")).toContainText("خَرِبَةً");
  await expect(study(page).locator(".greek-main").first()).not.toContainText(
    "الْبَدْءِ",
  );
});

test("OT study fits phone widths, landscape and 200% reflow in both themes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("word-font", "38");
    localStorage.setItem("word-diacritics", "false");
  });
  await page.goto("/?mode=bible&book=PSA&chapter=119");
  await ready(page);
  await openVerse(page, 176);
  await studyContents(page);
  for (const [width, height] of [
    [320, 700],
    [360, 800],
    [390, 844],
    [430, 932],
    [844, 390],
    [640, 700],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate((width) => {
      document.documentElement.style.zoom = width === 640 ? "2" : "1";
    }, width);
    for (const dark of [false, true]) {
      await page.evaluate((dark) => {
        document.documentElement.dataset.theme = dark ? "dark" : "light";
      }, dark);
      await noOverflow(page);
      expect(
        await study(page).evaluate(
          (el) => el.scrollWidth <= el.clientWidth + 1,
        ),
      ).toBe(true);
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAccessible(page, { include: "dialog[open]", wcag: true });
  await testInfo.attach("ot-study-mobile", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
