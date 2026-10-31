import { test, expect, type Page } from "@playwright/test";
import {
  closeSheet,
  menuButton,
  menuDialog,
  openSection,
  ready,
  study,
  stubConnection,
} from "./helpers";

// The only spec with the service worker; it needs Chromium's offline
// emulation of worker fetches.
test.use({ serviceWorkers: "allow" });
test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Offline emulation is Chromium's.");
  await stubConnection(page, { saveData: true });
});

const reading = (page: Page) => page.getByRole("article");
async function controlled(page: Page) {
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
    timeout: 20000,
  });
}

test("the app opens offline with the readings already opened", async ({
  page,
  context,
}) => {
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  await controlled(page);
  await page
    .getByRole("button", { name: "الإصحاح التالي", exact: true })
    .click();
  await ready(page);
  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await expect(reading(page)).toHaveAttribute("data-reading", "bible:GEN:2");
  // A chapter never opened still needs the network, and says so.
  await page
    .getByRole("button", { name: "الإصحاح التالي", exact: true })
    .click();
  await expect(reading(page).getByRole("alert")).toBeVisible();
  await context.setOffline(false);
});

test("verse study opened once, words and translations, stays available offline", async ({
  page,
  context,
}) => {
  async function openStudy() {
    await page.locator('#passage-0 .verse[data-v="1"] .verse-number').click();
    await openSection(page, "الكلمات العبرية");
    await expect(study(page).locator('bdi[lang="he"]').first()).toHaveText(
      "בְּ רֵאשִׁ֖ית",
    );
    await openSection(page, "ترجمات أخرى");
    await expect(study(page).locator(".study-english")).toContainText(
      "In the beginning",
    );
    await closeSheet(page);
  }
  await page.goto("/?mode=bible&book=GEN&chapter=1");
  await ready(page);
  await controlled(page);
  await openStudy();
  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await openStudy();
  await context.setOffline(false);
});

test("saving the Scripture text makes every mode readable offline", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  await page.goto("/");
  await ready(page);
  await controlled(page);
  await menuButton(page).click();
  const menu = menuDialog(page);
  await menu.getByText("القراءة دون اتصال وتثبيت التطبيق").click();
  const save = menu.getByRole("button", {
    name: "حفظ نص الكتاب المقدس للقراءة دون اتصال",
  });
  await expect(save).toBeEnabled();
  await save.click();
  // Exactly: the reader's progress line also says it is kept on the device.
  await expect(
    menu.getByText("محفوظ على هذا الجهاز", { exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await closeSheet(page);
  await context.setOffline(true);
  for (const [path, place] of [
    ["/?mode=bible&book=JHN&chapter=3", "bible:JHN:3"],
    ["/?mode=bible&book=MAL&chapter=4", "bible:MAL:4"],
    ["/?mode=chronological&testament=NT&reading=mrk-1-1", "chrono:NT:mrk-1-1"],
    ["/?mode=chronological&testament=OT&reading=deu-2-1", "chrono:OT:deu-2-1"],
  ] as const) {
    await page.goto(path);
    await ready(page);
    await expect(reading(page)).toHaveAttribute("data-reading", place);
  }
  await page.goto("/?day=40");
  await ready(page);
  await expect(reading(page)).toHaveAttribute("data-day", "40");
  await context.setOffline(false);
});

test("an install offer made before offline support loads is kept for the menu", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  // Chromium offers installation once, here well before the page settles.
  await page.evaluate(() => {
    const offer = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(offer, {
      prompt: async () => {
        (window as { prompted?: boolean }).prompted = true;
      },
    });
    dispatchEvent(offer);
  });
  await menuButton(page).click();
  const menu = menuDialog(page);
  await menu.getByText("القراءة دون اتصال وتثبيت التطبيق").click();
  const install = menu.getByRole("button", { name: "تثبيت التطبيق" });
  await expect(install).toBeVisible({ timeout: 15000 });
  await install.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as { prompted?: boolean }).prompted),
    )
    .toBe(true);
  await expect(install).toHaveCount(0);
});
