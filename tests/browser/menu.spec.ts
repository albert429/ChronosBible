import { test, expect } from "@playwright/test";
import { APP_INFO } from "../../src/appInfo.ts";
import {
  MODES,
  article,
  closeSheet,
  expectAccessible,
  menuButton,
  menuDialog,
  noOverflow,
  openAppearance,
  ready,
  chooseFromMenu,
  profile,
  seed,
  tabKey,
} from "./helpers";

test.describe("menu and About", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await ready(page);
  });

  test("subtle menu footer opens app credits and restores focus without changing reading", async ({
    page,
  }) => {
    // A fresh visitor reads Genesis 1 directly: no intro, no registration.
    await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:1");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      if (width === 320) {
        const settings = await openAppearance(page);
        await settings.getByRole("button", { name: "الوضع الليلي" }).click();
        await closeSheet(page);
      }
      const trigger = menuButton(page);
      await trigger.click();
      const dialog = menuDialog(page);
      const aboutLink = dialog.getByRole("button", { name: "عن التطبيق" });
      await expect(dialog.locator(".menu-source")).toContainText(
        "النص: ترجمة فان دايك · ملكية عامة",
      );
      const sizes = await dialog.evaluate((element) => {
        const source = element.querySelector(".menu-source")!;
        const link = element.querySelector(".about-link")!;
        return {
          sourceFont: getComputedStyle(source).fontSize,
          linkFont: getComputedStyle(link).fontSize,
          sourceX: source.getBoundingClientRect().x,
          linkRight: link.getBoundingClientRect().right,
          targetHeight: link.getBoundingClientRect().height,
        };
      });
      expect(sizes.linkFont).toBe(sizes.sourceFont);
      expect(sizes.linkRight).toBeLessThan(sizes.sourceX);
      expect(sizes.targetHeight).toBeGreaterThanOrEqual(44);
      await aboutLink.click();
      const about = page.getByRole("dialog", {
        name: "عن التطبيق",
        exact: true,
      });
      await expect(about).toContainText("شباب كنيسة الإخوة بخلوصي");
      await expect(about).toContainText("بالترتيب الزمني");
      await expect(
        about.getByRole("img", { name: APP_INFO.church }),
      ).toBeVisible();
      await expect(about).toContainText("لا يدّعي هذا التطبيق أي حقوق نشر");
      await expect(about).toContainText("توقيت تظليل الآيات تقريبي");
      await expect(
        about.getByRole("link", { name: "مصدر التسجيل" }),
      ).toHaveAttribute("href", "https://www.faithcomesbyhearing.com/");
      // The default build has no AI explanations, so no AI disclosure.
      await expect(about).not.toContainText("OpenRouter");
      await expect(
        about.getByRole("link", { name: "albertalfred429@gmail.com" }),
      ).toHaveAttribute("href", "mailto:albertalfred429@gmail.com");
      await expect(
        about.getByRole("link", { name: APP_INFO.githubName, exact: true }),
      ).toHaveAttribute("href", APP_INFO.githubUrl);
      await noOverflow(page);
      await expectAccessible(page);
      await page.keyboard.press("Escape");
      await expect(about).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await expect(article(page)).toHaveAttribute(
        "data-reading",
        "bible:GEN:1",
      );
    }
  });
});

test.describe("compact menu", () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
    await page.goto("/");
    await ready(page);
  });

  test("the menu lists the four modes in order, then reader progress with nested backups", async ({
    page,
  }) => {
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await menuButton(page).click();
      const dialog = menuDialog(page);
      await expect(dialog.locator(".menu-brand")).toContainText(APP_INFO.title);
      await expect(dialog.locator(".menu-brand")).toContainText(
        "قراءة واستماع، بالترتيب المعتاد أو الزمني",
      );
      const modes = dialog.getByRole("navigation").getByRole("button");
      await expect(modes).toHaveCount(4);
      for (const [index, name] of [
        MODES.bible,
        MODES.ot,
        MODES.nt,
        MODES.plan,
      ].entries())
        await expect(modes.nth(index)).toHaveAccessibleName(name);
      await expect(
        dialog.getByRole("heading", { name: "القراءة بالترتيب الزمني" }),
      ).toBeVisible();
      await expect(modes.nth(1)).toContainText("بحسب الترتيب الزمني");
      await expect(modes.nth(2)).toContainText("بحسب الترتيب الزمني");
      await expect(
        dialog.getByRole("heading", { name: "خطة قراءة العهد الجديد" }),
      ).toBeVisible();
      await expect(modes.nth(3)).toContainText(
        "خطة يومية لقراءة العهد الجديد كاملًا",
      );
      // The seeded reader is on the youth plan; that mode is current.
      await expect(modes.nth(3)).toHaveAttribute("aria-current", "page");
      await expect(
        dialog.getByRole("button", { name: "رحلتي في ١٥٠ يومًا" }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("heading", { name: "القارئ والتقدم" }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "إعدادات القارئ", exact: true }),
      ).toContainText("٢ من ١٥٠ يومًا مكتملًا");
      // Backups stay folded away until asked for.
      await expect(
        dialog.getByRole("button", { name: /نسخة احتياطية/ }),
      ).toHaveCount(0);
      const share = await dialog
        .getByRole("button", { name: "مشاركة التطبيق" })
        .boundingBox();
      const close = await dialog
        .getByRole("button", { name: "إغلاق النافذة" })
        .boundingBox();
      expect(share!.y).toBe(close!.y);
      expect(share!.height).toBeGreaterThanOrEqual(44);
      await noOverflow(page);
      if (width === 390) {
        await expectAccessible(page);
        await page.screenshot({
          path: test.info().outputPath("menu-minimal.png"),
          scale: "css",
        });
      }
      await closeSheet(page);
    }
    await menuButton(page).click();
    const dialog = menuDialog(page);
    await dialog
      .getByText("النسخ الاحتياطي والاستعادة", { exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "تنزيل نسخة احتياطية", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "استعادة نسخة احتياطية",
        exact: true,
      }),
    ).toBeVisible();
    await expectAccessible(page);
    await closeSheet(page);
    await chooseFromMenu(page, "إعدادات القارئ");
    await expect(
      page.getByRole("button", { name: "تغيير القارئ على هذا الجهاز" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menuButton(page)).toBeFocused();
  });

  test("menu modes are reachable and operable from the keyboard", async ({
    page,
    browserName,
  }) => {
    await menuButton(page).focus();
    await page.keyboard.press("Enter");
    const dialog = menuDialog(page);
    // The dialog takes focus (its first control: Share, beside Close).
    await expect(
      dialog.getByRole("button", { name: "مشاركة التطبيق" }),
    ).toBeFocused();
    // Tab forward until the Bible mode, then choose it with Enter.
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press(tabKey(browserName));
      const name = await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") ?? "",
      );
      if (name === MODES.bible) break;
    }
    await expect(
      dialog.getByRole("button", { name: MODES.bible, exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await ready(page);
    await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:1");
  });
});

test.describe("sharing", () => {
  test("share fallback contains a generic Arabic description and restores focus", async ({
    page,
  }) => {
    await seed(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        value: undefined,
        configurable: true,
      });
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            document.documentElement.dataset.copied = text;
          },
        },
        configurable: true,
      });
    });
    await page.goto("/");
    await ready(page);
    await chooseFromMenu(page, "مشاركة التطبيق");
    const field = page.getByRole("textbox", { name: "نص المشاركة" });
    await expect(field).toHaveAttribute("dir", "auto");
    await expect(field).toHaveValue(
      /الكتاب المقدس.*بالترتيب المعتاد.*بالترتيب الزمني.*تسجيل صوتي.*\nhttp/,
    );
    expect(await field.inputValue()).not.toContain(profile.name);
    await page.getByRole("button", { name: "نسخ", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-copied",
      await field.inputValue(),
    );
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await expect(menuButton(page)).toBeFocused();
  });

  for (const outcome of ["success", "cancel", "error"] as const) {
    test(`native sharing: ${outcome}`, async ({ page }) => {
      await page.addInitScript((outcome) => {
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async (data: ShareData) => {
            document.documentElement.dataset.shared = JSON.stringify(data);
            if (outcome !== "success")
              throw new DOMException(
                "Test share result",
                outcome === "cancel" ? "AbortError" : "NotAllowedError",
              );
          },
        });
      }, outcome);
      await page.goto("/");
      await ready(page);
      await chooseFromMenu(page, "مشاركة التطبيق");
      const payload = JSON.parse(
        (await page.locator("html").getAttribute("data-shared"))!,
      );
      expect(payload.title).toBe(APP_INFO.title);
      expect(payload.title).toBe("الكتاب المقدس");
      expect(payload.text).toContain("بالترتيب الزمني");
      expect(payload.text).toContain("تسجيل صوتي");
      expect(payload.url).toMatch(/^http/);
      await expect(
        page.getByRole("textbox", { name: "نص المشاركة" }),
      ).toHaveCount(outcome === "error" ? 1 : 0);
      if (outcome !== "error") {
        await expect(menuDialog(page)).toBeVisible();
        await expect(
          page.getByRole("button", { name: "مشاركة التطبيق", exact: true }),
        ).toBeEnabled();
      }
    });
  }
});
