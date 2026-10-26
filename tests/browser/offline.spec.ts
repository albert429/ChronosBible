import { test, expect, type Page } from "@playwright/test";
import {
  closeSheet,
  menuButton,
  menuDialog,
  ready,
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
