import { test, expect, type Page } from "@playwright/test";
import { chapterVerse } from "../../src/bible/reference.ts";
import {
  chooseFromMenu,
  closeSheet,
  createGate,
  expectAccessible,
  noOverflow,
  MODES,
  openAppearance,
  ready,
  recordRequests,
  stubConnection,
} from "./helpers";
import {
  POSITION_KEY,
  announcedDay,
  committedChapter,
  fulfillWav,
  routeChapterAudio,
} from "./chapterAudio";

// Canonical chapter audio runs against the fixture build only: accelerated
// copies of the committed manifests and synthetic WAV media, never a CDN.
test.skip(
  process.env.AUDIO_TEST_FIXTURES !== "1",
  "Needs the audio fixture build (npm run test:e2e)",
);

const audio = (page: Page) => page.locator("audio");
const currentTime = (page: Page) =>
  audio(page).evaluate((el: HTMLAudioElement) => el.currentTime);
const player = (page: Page) =>
  page.getByRole("region", { name: "مشغل القراءة الصوتية" });
const listen = (page: Page) =>
  page.getByRole("button", { name: "استمع إلى الإصحاح", exact: true });
const article = (page: Page) => page.getByRole("article");
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

async function open(page: Page, book: string, chapter: number) {
  await page.goto(`/?mode=bible&book=${book}&chapter=${chapter}`);
  await ready(page);
}
async function setContinuous(page: Page, enabled: boolean) {
  const settings = await openAppearance(page);
  await settings
    .getByRole("checkbox", { name: "استماع متواصل" })
    .setChecked(enabled);
  await closeSheet(page);
}
/** From page load, record the element, source and position of every start. */
async function recordStarts(page: Page) {
  await page.addInitScript(() => {
    const starts: [string, number][] = [];
    const record = { __starts: starts, __audio: null as Element | null };
    Object.assign(window, record);
    // Media events do not bubble, but a capturing document listener sees them.
    document.addEventListener(
      "playing",
      (event) => {
        const element = event.target as HTMLAudioElement;
        const own = window as unknown as typeof record;
        own.__audio ??= element;
        starts.push([element.currentSrc, element.currentTime]);
      },
      true,
    );
  });
}
const starts = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __starts: [string, number][] }).__starts,
  );
/** Whether the audio element now on the page is the first one that played. */
const sameElement = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector("audio") ===
      (window as unknown as { __audio: Element }).__audio,
  );

test("chapter audio loads only on request; Old Testament recordings disclose chapter-only timing", async ({
  page,
}) => {
  const { external } = await routeChapterAudio(page, {
    "GEN:1": { duration: 30 },
  });
  const requests = recordRequests(page, (path) => path.includes("/audio/"));
  await open(page, "GEN", 1);
  await page.waitForTimeout(700);
  expect(requests).toEqual([]);
  await listen(page).click();
  await expect(audio(page)).toHaveAttribute(
    "src",
    /^https:\/\/audio\.example\.test\/audio\/chapters\/assets\/GEN-1-[a-f0-9]+\.m4a$/,
  );
  await expect.poll(() => currentTime(page)).toBeGreaterThan(0);
  await expect(player(page)).toContainText("التكوين ١");
  await expect(player(page)).toContainText("تسجيل الإصحاح دون تتبع الآيات");
  // No verse cues are invented for an unaligned recording.
  await expect(page.locator("[data-listening]")).toHaveCount(0);
  await expect(button(page, "الآية السابقة")).toBeDisabled();
  await expect(button(page, "الآية التالية")).toBeDisabled();
  expect(requests[0]).toBe("/audio/chapters/GEN/1.json");
  expect(requests.slice(1).every((path) => /GEN-1-.+\.m4a$/.test(path))).toBe(
    true,
  );
  await expectAccessible(page, { include: ".audio-player", wcag: true });
  expect(external).toEqual([]);
});

test("a New Testament opening clears highlighting and verse skip goes past it", async ({
  page,
}) => {
  const { external } = await routeChapterAudio(page, {
    "MAT:1": { opening: 4, verse: 3 },
  });
  await open(page, "MAT", 1);
  await listen(page).click();
  await expect.poll(() => currentTime(page)).toBeGreaterThan(0);
  // The recording's own opening: no verse is being read.
  await expect(page.locator("[data-listening]")).toHaveCount(0);
  await expect(player(page).locator(".audio-current")).toHaveText(
    /^متى ١متى ١$/,
  );
  // The manifest's own label is never shown with Western digits.
  await expect(player(page).locator(".audio-current")).not.toContainText(
    /[0-9]/,
  );
  await expect(button(page, "الآية السابقة")).toBeDisabled();
  await button(page, "الآية التالية").click();
  await expect.poll(() => currentTime(page)).toBeGreaterThanOrEqual(4);
  await expect(page.locator('.verse[data-listening][data-v="1"]')).toHaveCount(
    1,
  );
  await expect(player(page)).toContainText(`متى ${chapterVerse(1, 1)}`);
  await button(page, "الآية التالية").click();
  await expect(page.locator('.verse[data-listening][data-v="2"]')).toHaveCount(
    1,
  );
  await button(page, "الآية السابقة").click();
  await button(page, "الآية السابقة").click();
  await expect(page.locator('.verse[data-listening][data-v="1"]')).toHaveCount(
    1,
  );
  expect(external).toEqual([]);
});

test("continuous listening keeps one audio element through a cold chapter load and stops after Revelation 22", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  const { external } = await routeChapterAudio(page, {
    "REV:21": { opening: 0.1, verse: 0.05 },
    "REV:22": { opening: 0.3, verse: 0.1 },
  });
  const gate = createGate();
  await page.route("**/bible/REV/22.json*", async (route) => {
    await gate.opened;
    await route.continue();
  });
  await recordStarts(page);
  await open(page, "REV", 21);
  await setContinuous(page, true);
  // A saved position for the next chapter must not apply to a handoff.
  const next = committedChapter("REV", 22).src;
  await page.evaluate(
    ([key, src]) => localStorage.setItem(key, JSON.stringify({ [src]: 2 })),
    [POSITION_KEY, next],
  );
  await listen(page).click();
  await button(page, "إيقاف مؤقت").focus();
  await expect(article(page)).toHaveAttribute("data-reading", "bible:REV:22", {
    timeout: 15000,
  });
  // The next chapter's text is still loading; the same element waits for it.
  await expect(article(page)).toHaveAttribute("aria-busy", "true");
  await expect(page).toHaveURL(/[?&]book=REV&chapter=22$/);
  await expect(audio(page)).toHaveCount(1);
  expect(await sameElement(page)).toBe(true);
  gate.open();
  await ready(page);
  await expect(audio(page)).toHaveAttribute("src", /REV-22-[a-f0-9]+\.m4a$/);
  await expect(player(page)).toContainText("انتهى التسجيل", {
    timeout: 15000,
  });
  expect(await sameElement(page)).toBe(true);
  const played = await starts(page);
  const handoff = played.find(([src]) => src.endsWith(next));
  expect(handoff?.[1]).toBeLessThan(1);
  // Focus stayed in the player rather than jumping to the main region.
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest(".audio-player"),
    ),
  ).toBe(true);
  // Revelation 22 is the end: no further chapter, no wrap-around, and the
  // last chapter may still be marked read.
  await expect(
    player(page).getByRole("button", { name: "نعم، تمت" }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:REV:22");
  await expect(button(page, "الإصحاح التالي")).toBeDisabled();
  await page.goBack();
  await expect(article(page)).toHaveAttribute("data-reading", "bible:REV:21");
  await expect(audio(page)).toHaveCount(0);
  expect(external).toEqual([]);
});

test("replaying an ended chapter re-arms continuous listening", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  const { external } = await routeChapterAudio(page, {
    "OBA:1": { duration: 0.8 },
    "JON:1": { duration: 30 },
  });
  await open(page, "OBA", 1);
  await listen(page).click();
  await expect(player(page)).toContainText("انتهى التسجيل", {
    timeout: 10000,
  });
  // Without continuous listening the chapter simply ends.
  await page.waitForTimeout(300);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:OBA:1");
  await setContinuous(page, true);
  await button(page, "تشغيل التسجيل").click();
  await expect(article(page)).toHaveAttribute("data-reading", "bible:JON:1", {
    timeout: 10000,
  });
  await expect(audio(page)).toHaveAttribute("src", /JON-1-[a-f0-9]+\.m4a$/);
  await expect.poll(() => currentTime(page)).toBeGreaterThan(0);
  expect(external).toEqual([]);
});

test("manual chapter, picker, mode and history navigation stop playback at once, even when continuous", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  const { external } = await routeChapterAudio(page, {
    "GEN:1": { duration: 30 },
    "GEN:2": { duration: 30 },
    "GEN:3": { duration: 30 },
  });
  const media = recordRequests(page, (path) => path.endsWith(".m4a"));
  await open(page, "GEN", 1);
  await setContinuous(page, true);
  async function play() {
    await listen(page).click();
    await expect.poll(() => currentTime(page)).toBeGreaterThan(0);
  }
  await play();
  await button(page, "الإصحاح التالي").click();
  await expect(audio(page)).toHaveCount(0);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:2");
  await ready(page);
  await play();
  // Choosing the chapter already open is still a manual selection.
  await page.getByRole("button", { name: /^اختيار السفر والإصحاح:/ }).click();
  await page
    .getByRole("dialog", { name: "الكتاب المقدس", exact: true })
    .getByRole("button", { name: "التكوين ٢", exact: true })
    .click();
  await expect(audio(page)).toHaveCount(0);
  await ready(page);
  await play();
  await chooseFromMenu(page, MODES.plan);
  await expect(audio(page)).toHaveCount(0);
  await ready(page);
  await chooseFromMenu(page, MODES.bible);
  await ready(page);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:GEN:2");
  await play();
  await page.goBack();
  await expect(audio(page)).toHaveCount(0);
  await ready(page);
  await page.goForward();
  await ready(page);
  // A manifest still loading when the reader leaves never starts playing.
  const gate = createGate();
  await page.route("**/audio/chapters/GEN/3.json", async (route) => {
    await gate.opened;
    await route.fallback();
  });
  await button(page, "الإصحاح التالي").click();
  await ready(page);
  await listen(page).click();
  await expect(player(page)).toContainText("جارٍ تحميل التسجيل");
  await button(page, "الإصحاح التالي").click();
  await expect(audio(page)).toHaveCount(0);
  gate.open();
  await page.waitForTimeout(500);
  await expect(audio(page)).toHaveCount(0);
  expect(media.some((path) => path.includes("GEN-3-"))).toBe(false);
  expect(external).toEqual([]);
});

test("stale chapter manifests never play and failed ones retry", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  const { external } = await routeChapterAudio(page, {
    "GEN:1": { readingHash: "0".repeat(64) },
    "GEN:2": { duration: 30 },
  });
  const media = recordRequests(page, (path) => path.endsWith(".m4a"));
  await open(page, "GEN", 1);
  await listen(page).click();
  await expect(player(page).getByRole("alert")).toContainText(
    "يحتاج التسجيل إلى تحديث ليتطابق مع نص هذا الإصحاح.",
  );
  await expect(audio(page)).not.toHaveAttribute("src");
  let fail = true;
  await page.route("**/audio/chapters/GEN/2.json", (route) =>
    fail ? route.fulfill({ status: 503 }) : route.fallback(),
  );
  await button(page, "الإصحاح التالي").click();
  await ready(page);
  await listen(page).click();
  await expect(player(page).getByRole("alert")).toContainText(
    "تعذر تحميل التسجيل",
  );
  fail = false;
  await player(page).getByRole("button", { name: "حاول مرة أخرى" }).click();
  await expect.poll(() => currentTime(page)).toBeGreaterThan(0);
  expect(media.every((path) => path.includes("GEN-2-"))).toBe(true);
  expect(external).toEqual([]);
});

test("resume positions belong to one recording and are saved sparingly", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  await page.addInitScript((key) => {
    const writes: string[] = [];
    Object.assign(window, { __writes: writes });
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key) writes.push(value);
      return setItem.call(this, name, value);
    };
  }, POSITION_KEY);
  const writes = () =>
    page.evaluate(
      () => (window as unknown as { __writes: string[] }).__writes.length,
    );
  const { external } = await routeChapterAudio(page, {
    "GEN:1": { duration: 30 },
  });
  const src = committedChapter("GEN", 1).src;
  await recordStarts(page);
  await open(page, "GEN", 1);
  await listen(page).click();
  await expect.poll(() => currentTime(page)).toBeGreaterThan(2.5);
  expect(await writes()).toBe(0);
  await button(page, "إيقاف مؤقت").click();
  await expect.poll(writes).toBe(1);
  const saved = await page.evaluate(
    ([key, src]) => JSON.parse(localStorage.getItem(key)!)[src],
    [POSITION_KEY, src],
  );
  expect(saved).toBeGreaterThan(2.5);
  await button(page, "إيقاف وإغلاق المشغل").click();
  await listen(page).click();
  await expect.poll(() => currentTime(page)).toBeGreaterThan(saved);
  expect((await starts(page)).at(-1)![1]).toBeGreaterThanOrEqual(saved - 0.1);
  // Rebuilt media has a new immutable name, so an old position cannot apply.
  await routeChapterAudio(page, {
    "GEN:1": {
      duration: 30,
      src: "/audio/chapters/assets/GEN-1-ffffffffffffffffffff.m4a",
    },
  });
  await page.reload();
  await ready(page);
  await listen(page).click();
  await expect(audio(page)).toHaveAttribute(
    "src",
    /GEN-1-ffffffffffffffffffff\.m4a$/,
  );
  await expect.poll(() => currentTime(page)).toBeGreaterThan(0);
  const rebuilt = (await starts(page)).filter(([url]) => url.includes("ffff"));
  expect(rebuilt[0][1]).toBeLessThan(1);
  expect(external).toEqual([]);
});

test("canonical reading with the player fits phones, dark maximum text and 200% reflow", async ({
  page,
}) => {
  const { external } = await routeChapterAudio(page, {
    "1TH:5": { opening: 30, verse: 2 },
  });
  await page.addInitScript(() => {
    localStorage.setItem("word-font", "38");
    localStorage.setItem("word-dark", "true");
  });
  await page.goto("/?mode=bible&book=JHN&chapter=3&verse=16");
  await ready(page);
  // A linked verse starts below the sticky toolbar, which grows with the text.
  const toolbar = (await page.locator(".topbar").boundingBox())!;
  const verse = (await page.locator('.verse[data-v="16"]').boundingBox())!;
  expect(verse.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
  expect(verse.y).toBeLessThan(toolbar.y + toolbar.height + 120);
  await expect(page.locator('.verse[data-v="16"] .verse-number')).toBeFocused();
  await open(page, "1TH", 5);
  await listen(page).click();
  await expect.poll(() => currentTime(page)).toBeGreaterThan(0);
  for (const [width, height] of [
    [320, 640],
    [360, 740],
    [390, 844],
    [430, 932],
    [195, 422],
  ]) {
    await page.setViewportSize({ width, height });
    await noOverflow(page);
    const targets = await player(page)
      .locator("button")
      .evaluateAll((buttons) =>
        buttons.map((b) => b.getBoundingClientRect().height),
      );
    expect(targets.every((h) => h >= 44)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAccessible(page, { wcag: true });
  await page.screenshot({
    path: test.info().outputPath("bible-player-dark.png"),
    scale: "css",
  });
  expect(external).toEqual([]);
});

test("a heading inside the listening verse is not marked as read text", async ({
  page,
}) => {
  const { external } = await routeChapterAudio(page, {
    "JHN:19": { verse: 2 },
  });
  await open(page, "JHN", 19);
  // «الصلب» falls inside verse 16, before the words that close it.
  const heading = page.locator('.verse[data-v="16"] .scripture-inline-note');
  await expect(heading).toHaveText("الصلب");
  await heading.scrollIntoViewIfNeeded();
  const unread = await heading.screenshot();
  await listen(page).click();
  await expect.poll(() => currentTime(page)).toBeGreaterThan(0);
  await button(page, "إيقاف مؤقت").click();
  await expect(button(page, "تشغيل التسجيل")).toBeVisible();
  // Paused in the recording's opening (no verse) or on an early verse.
  const listening = page.locator(".verse[data-listening]");
  const current = async () =>
    (await listening.count())
      ? Number(await listening.getAttribute("data-v"))
      : 0;
  for (let n = await current(); n < 16; n = await current()) {
    await button(page, "الآية التالية").click();
    await expect.poll(current).toBeGreaterThan(n);
  }
  const verse = page.locator('.verse[data-listening][data-v="16"]');
  await expect(verse).toHaveCount(1);
  expect(
    await verse.evaluate((el) => getComputedStyle(el).textDecorationLine),
  ).toBe("underline");
  // The verse is underlined, but the heading looks exactly as before.
  await heading.scrollIntoViewIfNeeded();
  expect(await heading.screenshot()).toEqual(unread);
  expect(external).toEqual([]);
});

test("an announced plan day shows each spoken reference, highlights no verse during it and skips past it", async ({
  page,
}) => {
  const { external } = await routeChapterAudio(page);
  const manifest = announcedDay(1);
  await page.route("**/audio/1.json", (route) =>
    route.fulfill({ json: manifest }),
  );
  await page.route("https://audio.example.test/audio/days/*.m4a", (route) =>
    fulfillWav(route, manifest.duration),
  );
  await page.goto("/?day=1");
  await ready(page);
  await page.getByRole("button", { name: "استمع إلى قراءة اليوم" }).click();
  await expect.poll(() => currentTime(page)).toBeGreaterThan(0);
  await button(page, "إيقاف مؤقت").click();
  // Seek deterministically rather than racing accelerated playback.
  const at = (seconds: number) =>
    audio(page).evaluate((el: HTMLAudioElement, seconds) => {
      el.currentTime = seconds;
    }, seconds);
  const highlighted = page.locator("[data-listening]");
  const [first, second] = manifest.announcements;
  await at(1);
  await expect(player(page)).toContainText(first.reference);
  await expect(highlighted).toHaveCount(0);
  await expect(button(page, "الآية السابقة")).toBeDisabled();
  await button(page, "الآية التالية").click();
  await expect(
    page.locator('#passage-0 .verse[data-v="1"][data-listening]'),
  ).toHaveCount(1);
  await expect(player(page)).not.toContainText(first.reference);
  await at((second.start + second.end) / 2);
  await expect(highlighted).toHaveCount(0);
  await expect(player(page)).toContainText(second.reference);
  await button(page, "الآية التالية").click();
  await expect(
    page.locator('#passage-1 .verse[data-v="1"][data-listening]'),
  ).toHaveCount(1);
  await at((second.start + second.end) / 2);
  await button(page, "الآية السابقة").click();
  await expect(
    page.locator('#passage-0 .verse[data-v="1"][data-listening]'),
  ).toHaveCount(1);
  expect(external).toEqual([]);
});

test("the end choice repeats a chapter, and «stop» offers to mark it read", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  const { external } = await routeChapterAudio(page, {
    "OBA:1": { duration: 0.8 },
  });
  await open(page, "OBA", 1);
  await listen(page).click();
  // Stopping at the end offers completion; it is never assumed.
  await expect(player(page)).toContainText("هل أتممت هذه القراءة؟", {
    timeout: 10000,
  });
  await button(page, "نعم، تمت").click();
  await expect(page.getByRole("button", { name: "تراجع" })).toBeVisible();
  await expect(player(page)).not.toContainText("هل أتممت هذه القراءة؟");
  // stop → next → repeat, named by what happens at the end.
  const end = player(page).getByRole("button", { name: /^عند الانتهاء:/ });
  await expect(end).toHaveAccessibleName("عند الانتهاء: إيقاف");
  await end.click();
  await expect(end).toHaveAccessibleName("عند الانتهاء: متابعة إلى التالي");
  await end.click();
  await expect(end).toHaveAccessibleName("عند الانتهاء: إعادة القراءة");
  const starts = await page.evaluate(() => {
    const el = document.querySelector("audio")!;
    (window as unknown as { __plays: number }).__plays = 0;
    el.addEventListener("playing", () => {
      (window as unknown as { __plays: number }).__plays++;
    });
    return 0;
  });
  await button(page, "تشغيل التسجيل").click();
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as { __plays: number }).__plays),
      { timeout: 10000 },
    )
    .toBeGreaterThan(starts + 1);
  await expect(article(page)).toHaveAttribute("data-reading", "bible:OBA:1");
  await expect(player(page)).not.toContainText("انتهى التسجيل");
  // The choice is kept, and the settings checkbox agrees with it.
  await page.reload();
  await ready(page);
  const settings = await openAppearance(page);
  await expect(
    settings.getByRole("checkbox", { name: "استماع متواصل" }),
  ).not.toBeChecked();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("bible-reader-audio-repeat-v1"),
    ),
  ).toBe("true");
  expect(external).toEqual([]);
});

test("listening continues under the reading settings; speed and seeking persist", async ({
  page,
}) => {
  await stubConnection(page, { saveData: true });
  const { external } = await routeChapterAudio(page, {
    "GEN:1": { duration: 30 },
  });
  await open(page, "GEN", 1);
  await listen(page).click();
  await expect.poll(() => currentTime(page)).toBeGreaterThan(0);
  await openAppearance(page);
  const before = await currentTime(page);
  await expect.poll(() => currentTime(page)).toBeGreaterThan(before + 0.3);
  expect(await audio(page).evaluate((el: HTMLAudioElement) => el.paused)).toBe(
    false,
  );
  await closeSheet(page);
  // The slider seeks the recording.
  const seek = player(page).getByRole("slider", { name: "موضع التسجيل" });
  await seek.fill("20");
  await expect.poll(() => currentTime(page)).toBeGreaterThanOrEqual(20);
  await button(page, "سرعة القراءة: ١×").click();
  await expect(button(page, "سرعة القراءة: ١٫٢٥×")).toBeVisible();
  await button(page, "إغلاق المشغل").click();
  await expect(audio(page)).toHaveCount(0);
  await expect(listen(page)).toBeFocused();
  await listen(page).click();
  await expect(button(page, "سرعة القراءة: ١٫٢٥×")).toBeVisible();
  await expect
    .poll(() => audio(page).evaluate((el: HTMLAudioElement) => el.playbackRate))
    .toBe(1.25);
  expect(external).toEqual([]);
});
