import { test, expect, type Page } from "@playwright/test";
import { STATE_KEY } from "../../src/plan/progress.ts";
import {
  article,
  chooseFromMenu,
  completeButton,
  menuButton,
  menuDialog,
  openPlanCalendar,
  profile,
  ready,
  seed,
  storedState,
  undoButton,
} from "./helpers";

async function openBackups(page: Page) {
  await menuButton(page).click();
  await menuDialog(page)
    .getByText("النسخ الاحتياطي والاستعادة", { exact: true })
    .click();
}

test.describe("progress and backup", () => {
  test("completion, undo, backup, restore, and reader switching preserve profiles", async ({
    page,
  }) => {
    await seed(page);
    await page.goto("/");
    await ready(page);
    await expect(article(page)).toHaveAttribute("data-day", "10");
    await completeButton(page).click();
    await expect(undoButton(page)).toBeVisible();
    await expect(page.getByText("تمت قراءة هذا اليوم")).toBeVisible();
    await page.reload();
    await ready(page);
    await expect(undoButton(page)).toBeVisible();
    await undoButton(page).click();
    await expect(completeButton(page)).toBeVisible();
    await openBackups(page);
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "تنزيل نسخة احتياطية", exact: true })
      .click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    expect(backupPath).toBeTruthy();
    await page.getByLabel("ملف النسخة الاحتياطية").setInputFiles(backupPath!);
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText(
      "تمت الاستعادة كقارئ منفصل",
    );
    const restored = await storedState(page);
    expect(restored.profiles).toHaveLength(2);
    expect(restored.activeId).not.toBe(profile.id);
    expect(restored.profiles[0]).toMatchObject({
      id: profile.id,
      name: profile.name,
      startDate: profile.startDate,
    });
    expect(restored.profiles[0].completion.plan).toEqual([2, 4]);
    expect(restored.profiles[1].completion.plan).toEqual([2, 4]);
    expect(restored.profiles[1].name).toBe(profile.name);
    await chooseFromMenu(page, "إعدادات القارئ");
    await page
      .getByRole("button", { name: "تغيير القارئ على هذا الجهاز" })
      .click();
    await page.getByLabel("متابعة قارئ محفوظ").selectOption(profile.id);
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect((await storedState(page)).activeId).toBe(profile.id);
  });

  test("guests complete and undo readings in every mode without signing up", async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page);
    await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:1");
    // Opening a reading never completes it.
    expect((await storedState(page)).guest.completion.bible).toEqual([]);
    await completeButton(page).click();
    await expect(page.getByText("تمت قراءة هذا الإصحاح")).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect((await storedState(page)).guest.completion.bible).toEqual(["GEN:1"]);
    await page.reload();
    await ready(page);
    await expect(undoButton(page)).toBeVisible();
    await undoButton(page).click();
    await expect(completeButton(page)).toBeVisible();
    expect((await storedState(page)).guest.completion.bible).toEqual([]);
    await page.goto("/?day=3");
    await ready(page);
    await completeButton(page).click();
    await expect(undoButton(page)).toBeVisible();
    const state = await storedState(page);
    expect(state.profiles).toEqual([]);
    expect(state.guest.completion.plan).toEqual([3]);
    expect(state.guest.completion.bible).toEqual([]);
  });

  test("new readers can be added; failed storage does not claim a successful save", async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page);
    await chooseFromMenu(page, "القراء على هذا الجهاز");
    await page
      .getByRole("textbox", { name: "الاسم", exact: true })
      .fill("قارئ جديد");
    await page
      .getByRole("button", { name: "إضافة القارئ", exact: true })
      .click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.evaluate((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException("full", "QuotaExceededError");
        original.call(this, name, value);
      };
    }, STATE_KEY);
    await completeButton(page).click();
    await expect(page.getByRole("alert")).toContainText("لم يتم الحفظ");
    await expect(completeButton(page)).toBeVisible();
    const state = await storedState(page);
    expect(state.profiles[0].name).toBe("قارئ جديد");
    expect(state.profiles[0].completion.bible).toEqual([]);
  });

  test("progress written in another tab updates this one and only a reader change changes the place", async ({
    page,
  }) => {
    await seed(page);
    await page.goto("/");
    await ready(page);
    const other = await page.context().newPage();
    await seed(other);
    await other.goto("/");
    await ready(other);
    const write = (change: string) =>
      other.evaluate(
        ({ key, change }) => {
          const state = JSON.parse(localStorage.getItem(key)!);
          if (change === "complete") {
            state.profiles[0].completion.plan = [2, 3, 4];
            state.profiles[0].completed = [2, 3, 4];
          } else state.activeId = change === "guest" ? null : "reader-one";
          localStorage.setItem(key, JSON.stringify(state));
        },
        { key: STATE_KEY, change },
      );
    await openPlanCalendar(page);
    await page.locator(".calendar-day").nth(2).click();
    await ready(page);
    await expect(article(page)).toHaveAttribute("data-day", "3");
    await expect(completeButton(page)).toBeVisible();
    await write("complete");
    await expect(undoButton(page)).toBeVisible();
    await expect(article(page)).toHaveAttribute("data-day", "3");
    // Without a named reader: the guest's own place. This device migrated
    // from v1 without saved places, so the guest reads the plan on day 1.
    await write("guest");
    await expect(article(page)).toHaveAttribute("data-day", "1");
    // Back to the reader: the plan place they last left, not today's day.
    await write("reader");
    await expect(article(page)).toHaveAttribute("data-day", "3");
  });
});
