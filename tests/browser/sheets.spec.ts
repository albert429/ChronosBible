import { test, expect } from "@playwright/test";
import {
  closeSheet,
  menuButton,
  menuDialog,
  noOverflow,
  openAppearance,
  ready,
} from "./helpers";

test.describe("sheets and focus", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?day=1");
    await ready(page);
  });

  test("reading sheets restore focus and preferences persist without changing the text", async ({
    page,
  }) => {
    const scripture = await page.locator(".scripture").textContent();
    for (const name of [
      "تفاصيل اليوم ١ · العهد الجديد في ١٥٠ يومًا",
      "إعدادات القراءة",
    ]) {
      const trigger = page.getByRole("button", { name, exact: true });
      await trigger.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    const settings = await openAppearance(page);
    await settings
      .getByRole("button", { name: "الوضع الليلي", exact: true })
      .click();
    await expect(
      settings.getByRole("button", { name: "الوضع الليلي", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    for (let i = 0; i < 5; i++)
      await settings
        .getByRole("button", { name: "تكبير الخط", exact: true })
        .click();
    await expect(
      settings.getByRole("button", { name: "تكبير الخط", exact: true }),
    ).toBeDisabled();
    await closeSheet(page);
    await page.reload();
    await ready(page);
    await expect(page.locator(".verse-text").first()).toHaveCSS(
      "font-size",
      "38px",
    );
    expect(await page.locator(".scripture").textContent()).toBe(scripture);
    const restored = await openAppearance(page);
    await expect(
      restored.getByRole("button", { name: "الوضع الليلي", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await closeSheet(page);
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page);
    }
  });

  test("reduced motion suppresses sheet animation and standard motion uses a brief transition", async ({
    page,
  }) => {
    const settings = await openAppearance(page);
    const duration = await settings
      .locator(".sheet-surface")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          animation: style.animationDuration,
          transition: style.transitionDuration,
        };
      });
    for (const value of [duration.animation, duration.transition])
      for (const seconds of value.split(","))
        expect(parseFloat(seconds)).toBeLessThanOrEqual(0.001);
    await closeSheet(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const animated = await openAppearance(page);
    const timings = await animated
      .locator(".sheet-surface")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return [
          ...style.animationDuration.split(","),
          ...style.transitionDuration.split(","),
        ].map(parseFloat);
      });
    expect(Math.max(...timings)).toBeGreaterThan(0);
    expect(Math.max(...timings)).toBeLessThanOrEqual(0.2);
    await closeSheet(page);
  });
});

test.describe("animated sheets", () => {
  test.use({ reducedMotion: "no-preference" });

  test("sheet content survives exit, releases after closing, and rapid reopen stays usable", async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page);
    await expect(page.locator(".menu-brand")).toHaveCount(0);
    const trigger = menuButton(page);
    await trigger.click();
    const dialog = menuDialog(page);
    await expect(dialog.locator(".menu-brand")).toBeVisible();
    await dialog.evaluate((element) =>
      element
        .querySelector<HTMLButtonElement>('[aria-label="إغلاق النافذة"]')!
        .click(),
    );
    await expect(dialog).toHaveAttribute("data-closing", "true");
    await expect(page.locator(".menu-brand")).toHaveCount(1);
    await page.evaluate(() =>
      document.querySelector<HTMLButtonElement>(".menu-toggle")!.click(),
    );
    await expect(dialog).not.toHaveAttribute("data-closing", "true");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.locator(".menu-brand")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.evaluate((element) => (element as HTMLDialogElement).close());
    await expect(page.locator(".menu-brand")).toHaveCount(0);
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  });
});
