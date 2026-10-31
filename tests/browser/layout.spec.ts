import { test, expect, type Page } from "@playwright/test";
import {
  closeSheet,
  expectAccessible,
  menuButton,
  noOverflow,
  openAppearance,
  openDayDetails,
  openPlanCalendar,
  ready,
} from "./helpers";
import { LONG_TITLE, stubChronology } from "./chronology";

/** A first visit to each mode's address; chronologies use the fixture. */
const MODE_URLS = [
  ["fresh Genesis", "/"],
  ["youth plan", "/?day=1"],
  [
    "Old Testament chronology",
    "/?mode=chronological&testament=OT&reading=gen-1-1",
  ],
  [
    "New Testament chronology",
    "/?mode=chronological&testament=NT&reading=luk-1-1",
  ],
  [
    "long chronological title",
    "/?mode=chronological&testament=OT&reading=gen-12-1",
  ],
] as const;
const VIEWPORTS = [
  { width: 320, height: 720 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 844, height: 390 },
];

async function toolbarIsOneRow(page: Page, width: number) {
  const header = await page.locator(".topbar").boundingBox();
  expect(header!.height).toBe(60);
  const buttons = await page.locator(".topbar button").evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  expect(buttons).toHaveLength(5);
  for (const button of buttons) {
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.y).toBeGreaterThanOrEqual(header!.y);
    expect(button.y + button.height).toBeLessThanOrEqual(
      header!.y + header!.height,
    );
    expect(button.x).toBeGreaterThanOrEqual(0);
    expect(button.x + button.width).toBeLessThanOrEqual(width);
  }
}

test.describe("layout", () => {
  test.beforeEach(async ({ page }) => {
    await stubChronology(page);
  });

  for (const [name, url] of MODE_URLS)
    test(`${name}: the first verse begins within 200px and the toolbar stays a single accessible row`, async ({
      page,
    }) => {
      await page.goto(url);
      await ready(page);
      const verse = await page.locator(".verse").first().boundingBox();
      expect(verse).not.toBeNull();
      expect(verse!.y).toBeLessThanOrEqual(200);
      await expect(page.locator(".verse-text").first()).toHaveCSS(
        "font-size",
        "28px",
      );
      await expect(page.locator(".verse-text").first()).toHaveCSS(
        "line-height",
        "56px",
      );
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await noOverflow(page);
        await toolbarIsOneRow(page, viewport.width);
      }
      await page.locator(".passage").last().scrollIntoViewIfNeeded();
      expect((await page.locator(".topbar").boundingBox())!.y).toBe(0);
    });

  test("a long mode place ends in an ellipsis and keeps its full accessible name", async ({
    page,
  }) => {
    await page.goto("/?mode=chronological&testament=OT&reading=gen-12-1");
    await ready(page);
    const trigger = page.getByRole("button", {
      name: `فهرس العهد القديم بالترتيب الزمني: ${LONG_TITLE}`,
      exact: true,
    });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(trigger).toBeVisible();
      const place = trigger.locator(".toolbar-place > span");
      expect(
        await place.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      ).toBe(true);
      await expect(place).toHaveCSS("text-overflow", "ellipsis");
      await expect(trigger.locator(".toolbar-place small")).toHaveText(
        "زمني · العهد القديم",
      );
      expect((await page.locator(".topbar").boundingBox())!.height).toBe(60);
    }
  });
});

test.describe("accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await stubChronology(page);
  });

  test("light and dark reading, picker, appearance and menu sheets remain accessible in every mode", async ({
    page,
  }) => {
    const pickers = [
      ["/?day=1", () => openDayDetails(page)],
      [
        "/?mode=bible&book=GEN&chapter=1",
        () =>
          page.getByRole("button", { name: /^اختيار السفر والإصحاح:/ }).click(),
      ],
      [
        "/?mode=chronological&testament=NT&reading=luk-1-1",
        async () => {
          await page
            .getByRole("button", { name: /^فهرس العهد الجديد/ })
            .click();
          await expect(page.locator(".stage-list")).toBeVisible();
        },
      ],
    ] as const;
    for (const [url, openPicker] of pickers) {
      await page.goto(url);
      await ready(page);
      for (const dark of [false, true]) {
        if (dark) {
          const settings = await openAppearance(page);
          await settings
            .getByRole("button", { name: "الوضع الليلي", exact: true })
            .click();
          await closeSheet(page);
        }
        for (const sheet of ["reading", "picker", "appearance", "menu"]) {
          if (sheet === "picker") await openPicker();
          if (sheet === "appearance") await openAppearance(page);
          if (sheet === "menu") await menuButton(page).click();
          await noOverflow(page);
          await expectAccessible(page, { wcag: true });
          if (sheet !== "reading") await closeSheet(page);
        }
        if (dark) {
          const settings = await openAppearance(page);
          await settings
            .getByRole("button", { name: "الوضع النهاري", exact: true })
            .click();
          await closeSheet(page);
        }
      }
    }
    await page.goto("/?day=1");
    await ready(page);
    await page.setViewportSize({ width: 320, height: 720 });
    await openPlanCalendar(page);
    await expect(page.locator(".calendar-day")).toHaveCount(30);
    await noOverflow(page);
    await expectAccessible(page, { wcag: true });
  });
});

test.describe("200% reflow", () => {
  test("200% phone reflow keeps day navigation accessible without horizontal scrolling", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 195, height: 422 });
    await page.goto("/?day=1");
    await ready(page);
    await noOverflow(page);
    const details = await openDayDetails(page);
    await expect(
      details.getByRole("button", { name: "اليوم السابق" }),
    ).toBeDisabled();
    await details.getByRole("button", { name: "اليوم التالي" }).click();
    await ready(page);
    await expect(page.getByRole("article")).toHaveAttribute("data-day", "2");
    await noOverflow(page);
  });

  test("200% reflow with dark maximum text keeps every mode's selector usable", async ({
    page,
  }) => {
    await stubChronology(page);
    await page.goto("/");
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
    await closeSheet(page);
    await page.setViewportSize({ width: 195, height: 422 });
    for (const url of [
      "/",
      "/?day=1",
      "/?mode=chronological&testament=OT&reading=gen-12-1",
    ]) {
      await page.goto(url);
      await ready(page);
      await expect(page.locator(".verse-text").first()).toHaveCSS(
        "font-size",
        "38px",
      );
      await noOverflow(page);
      expect((await page.locator(".topbar").boundingBox())!.height).toBe(60);
      const trigger = page.locator(".day-trigger");
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("dialog[open]")).toHaveCount(1);
      await noOverflow(page);
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  });
});

test.describe("appearance", () => {
  const theme = (page: Page) =>
    page.evaluate(() => [
      document.documentElement.dataset.theme,
      document
        .querySelector('meta[name="theme-color"]')!
        .getAttribute("content"),
    ]);

  test("the theme follows the device until the reader chooses one", async ({
    page,
  }) => {
    // Until now everyone stored "false"; that old default now means auto.
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("word-dark", "false");
      }
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await ready(page);
    expect(await theme(page)).toEqual(["dark", "#181e1a"]);
    const sheet = await openAppearance(page);
    const auto = sheet.getByRole("button", { name: "حسب إعداد الجهاز" });
    await expect(auto).toHaveAttribute("aria-pressed", "true");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => theme(page)).toEqual(["light", "#f7f5ef"]);
    await sheet.getByRole("button", { name: "الوضع الليلي" }).click();
    await page.reload();
    await ready(page);
    expect(await theme(page)).toEqual(["dark", "#181e1a"]);
    await openAppearance(page);
    await auto.click();
    expect(await theme(page)).toEqual(["light", "#f7f5ef"]);
    await expectAccessible(page, { wcag: true });
  });

  test("verse numbers, headings and titles grow with large text", async ({
    page,
  }) => {
    const sizes = () =>
      page.evaluate(() =>
        [".verse sup", ".passage h2"].map((selector) =>
          parseFloat(
            getComputedStyle(document.querySelector(selector)!).fontSize,
          ),
        ),
      );
    await page.goto("/?mode=bible&book=PSA&chapter=23");
    await ready(page);
    const [number, title] = await sizes();
    expect(number).toBeCloseTo(12, 0);
    expect(title).toBeCloseTo(24, 0);
    await page.evaluate(() => localStorage.setItem("word-font", "38"));
    await page.reload();
    await ready(page);
    const [large, largeTitle] = await sizes();
    expect(large).toBeGreaterThan(16);
    expect(largeTitle).toBeGreaterThan(32);
    // The number's own target reaches 24×24px without growing the line.
    const target = await page
      .locator(".verse-number")
      .first()
      .evaluate((el) => {
        const after = getComputedStyle(el, "::after");
        const box = el.getBoundingClientRect();
        return [
          box.width - 2 * parseFloat(after.left),
          box.height - 2 * parseFloat(after.top),
        ];
      });
    expect(target[0]).toBeGreaterThanOrEqual(24);
    expect(target[1]).toBeGreaterThanOrEqual(24);
  });
});
