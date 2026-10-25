import { test, expect } from "@playwright/test";
import { createGate, ready } from "./helpers";

test.describe("loading layout", () => {
  test("completion bar waits for the chapter and does not shift the page", async ({
    page,
  }) => {
    const gate = createGate();
    await page.route("**/bible/GEN/1.json", async (route) => {
      await gate.opened;
      await route.continue();
    });
    await page.addInitScript(() => {
      const w = window as unknown as { shift: number };
      w.shift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          };
          if (!shift.hadRecentInput) w.shift += shift.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/");
    await expect(page.getByRole("article")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator(".reading-completion")).toHaveCount(0);
    const response = page.waitForResponse("**/bible/GEN/1.json");
    gate.open();
    await response;
    await ready(page);
    await expect(page.locator(".reading-completion")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "تمت القراءة" }),
    ).toBeEnabled();
    await page.waitForTimeout(300);
    const shift = await page.evaluate(
      () => (window as unknown as { shift: number }).shift,
    );
    expect(shift).toBeLessThan(0.02);
  });
});
