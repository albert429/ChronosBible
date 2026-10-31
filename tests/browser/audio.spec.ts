import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  closeSheet,
  createGate,
  MODES,
  expectAccessible,
  noOverflow,
  ready,
} from "./helpers";

// CI verifies the same native media behavior without redistributing recordings
// or reaching an external host. Local runs use the actual prepared narration.
test.beforeEach(async ({ page }) => {
  if (process.env.AUDIO_TEST_FIXTURES !== "1") return;
  const manifests = [1, 2, 3].map((day) => {
    const manifest = JSON.parse(
      readFileSync(`data/audio/manifests/${day}.json`, "utf8"),
    );
    return {
      ...manifest,
      duration: manifest.cues.length + 1,
      cues: manifest.cues.map((cue: object, i: number) => ({
        ...cue,
        start: i + 0.1,
        end: i + 0.9,
      })),
    };
  });
  await page.route("**/audio/*.json", async (route) => {
    const day = Number(
      new URL(route.request().url()).pathname
        .split("/")
        .pop()
        ?.replace(".json", ""),
    );
    await route.fulfill({ json: manifests[day - 1] });
  });
  await page.route("**/audio/days/*.m4a", async (route) => {
    const manifest = manifests.find((m) =>
      route.request().url().endsWith(m.src),
    )!;
    const size = 8000 * manifest.duration;
    const wav = Buffer.alloc(44 + size, 128);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + size, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(8000, 28);
    wav.writeUInt16LE(1, 32);
    wav.writeUInt16LE(8, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(size, 40);
    const range = /^bytes=(\d+)-(\d*)$/.exec(
      route.request().headers().range || "",
    );
    const start = range ? Number(range[1]) : 0;
    const end =
      range && range[2]
        ? Math.min(Number(range[2]), wav.length - 1)
        : wav.length - 1;
    await route.fulfill({
      status: range ? 206 : 200,
      contentType: "audio/wav",
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        ...(range
          ? { "Content-Range": `bytes ${start}-${end}/${wav.length}` }
          : {}),
      },
      body: wav.subarray(start, end + 1),
    });
  });
});

async function openPlayer(page: Page) {
  await page.goto("/?day=1");
  await ready(page);
  await page.getByRole("button", { name: "استمع إلى قراءة اليوم" }).click();
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    /\/audio\/days\/.+\.m4a/,
  );
}

test("audio loads only after listening, streams, and stops on day navigation", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/audio/")) requests.push(r.url());
  });
  await page.goto("/?day=1");
  await ready(page);
  expect(requests).toEqual([]);
  const firstVerse = await page.locator(".verse").first().boundingBox();
  expect(firstVerse!.y).toBeLessThanOrEqual(200);
  await page.getByRole("button", { name: "استمع إلى قراءة اليوم" }).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /\.m4a$/);
  await expect
    .poll(
      () =>
        page
          .locator("audio")
          .evaluate((el: HTMLAudioElement) => el.currentTime),
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
  expect(requests.some((url) => url.endsWith("/audio/1.json"))).toBe(true);
  expect(requests.some((url) => url.endsWith(".m4a"))).toBe(true);
  await page.getByRole("button", { name: "إيقاف مؤقت", exact: true }).click();
  await page.screenshot({
    path: test.info().outputPath("audio-preview.png"),
    scale: "css",
  });
  await page
    .getByRole("button", { name: "الآية التالية", exact: true })
    .click();
  await expect(page.locator("#passage-1 .verse[data-v='1']")).toHaveAttribute(
    "data-listening",
    "",
  );
  await page.getByRole("button", { name: "اليوم التالي", exact: true }).click();
  await expect(page.locator(".audio-player")).toHaveCount(0);
  await expect(page.locator("[data-listening]")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveAttribute("data-day", "2");
});

test("direct speed, close, study pause and highlights remain accessible on phones", async ({
  page,
}) => {
  await openPlayer(page);
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThan(0);
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
    const targets = await page
      .locator(".audio-player button")
      .evaluateAll((buttons) =>
        buttons.map((b) => b.getBoundingClientRect().height),
      );
    expect(targets.every((height) => height >= 44)).toBe(true);
  }
  await expect(
    page.getByRole("button", { name: "إعدادات الصوت", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "متابعة الآية أثناء الاستماع" }),
  ).toHaveCount(0);
  const speed = page.getByRole("button", { name: /^سرعة القراءة:/ });
  await speed.focus();
  for (const [rate, label] of [
    [1.25, "١٫٢٥×"],
    [1.5, "١٫٥×"],
    [0.75, "٠٫٧٥×"],
    [1, "١×"],
  ] as const) {
    await page.keyboard.press("Enter");
    await expect(speed).toHaveText(label);
    await expect
      .poll(() =>
        page
          .locator("audio")
          .evaluate((el: HTMLAudioElement) => el.playbackRate),
      )
      .toBe(rate);
    await expect
      .poll(() =>
        page.locator("audio").evaluate((el: HTMLAudioElement) => el.paused),
      )
      .toBe(false);
  }
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  // A verse is highlighted; studying a verse leaves the recording playing.
  await expect(page.locator("[data-listening]")).toHaveCount(1);
  await page.locator(".verse-number").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(
    await page.locator("audio").evaluate((el: HTMLAudioElement) => el.paused),
  ).toBe(false);
  await closeSheet(page);
  for (const theme of ["الوضع النهاري", "الوضع الليلي"]) {
    await page
      .getByRole("button", { name: "إعدادات القراءة", exact: true })
      .click();
    await page.getByRole("button", { name: theme, exact: true }).click();
    await closeSheet(page);
    await expectAccessible(page);
    const highlight = await page
      .locator("[data-listening]")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(highlight).toBe(
      theme === "الوضع النهاري" ? "rgb(225, 233, 212)" : "rgb(53, 69, 49)",
    );
  }
  await page.setViewportSize({ width: 195, height: 422 });
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "إيقاف وإغلاق المشغل", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "استمع إلى قراءة اليوم" }),
  ).toBeFocused();
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.locator("[data-listening]")).toHaveCount(0);
});

test("failed manifests retry; stale transcripts never play", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/audio/1.json", async (route) => {
    if (++attempts === 1) return route.fulfill({ status: 503, body: "failed" });
    await route.fallback();
  });
  await page.goto("/?day=1");
  await ready(page);
  await page.getByRole("button", { name: "استمع إلى قراءة اليوم" }).click();
  await expect(page.getByRole("alert")).toContainText("تعذر تحميل التسجيل");
  await page.getByRole("button", { name: "حاول مرة أخرى" }).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /\.m4a$/);
  expect(attempts).toBe(2);
  await page.unroute("**/audio/1.json");
  await page.route("**/audio/1.json", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.readingHash = "0".repeat(64);
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "استمع إلى قراءة اليوم" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "ليتطابق مع قراءة هذا اليوم",
  );
  await expect(page.locator("audio")).not.toHaveAttribute("src", /.+/);
  await page.unroute("**/audio/1.json");
  await page.getByRole("button", { name: "حاول مرة أخرى" }).click();
  await expect(page.locator("audio")).toHaveAttribute("src", /\.m4a$/);
});

test("text tracking stays on after manual scrolling and late data cannot restart another day", async ({
  page,
}) => {
  await openPlayer(page);
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThan(0);
  await page.locator(".scripture").dispatchEvent("wheel", { deltaY: 300 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const manifest = JSON.parse(
    readFileSync("data/audio/manifests/1.json", "utf8"),
  );
  const nextTime =
    process.env.AUDIO_TEST_FIXTURES === "1" ? 20.1 : manifest.cues[20].start;
  await page.locator("audio").evaluate((el: HTMLAudioElement, time) => {
    el.currentTime = time;
  }, nextTime);
  await expect
    .poll(() =>
      page.locator("[data-listening]").evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 60 && rect.top < innerHeight - 80;
      }),
    )
    .toBe(true);
  await page.reload();
  const gate = createGate();
  await page.route("**/audio/1.json", async (route) => {
    await gate.opened;
    await route.fallback();
  });
  await ready(page);
  await page.getByRole("button", { name: "استمع إلى قراءة اليوم" }).click();
  await page.getByRole("button", { name: "اليوم التالي", exact: true }).click();
  gate.open();
  await ready(page);
  await expect(page.locator("audio")).toHaveCount(0);
});

test("the player's own controls never stop the text from following", async ({
  page,
}) => {
  await openPlayer(page);
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThan(0);
  // Space on the focused pause button pauses; it does not scroll the page.
  await page.getByRole("button", { name: "إيقاف مؤقت" }).press("Space");
  await page.getByRole("button", { name: "تشغيل التسجيل" }).click();
  await expect(page.getByRole("button", { name: "إيقاف مؤقت" })).toBeVisible();
  await page.waitForTimeout(300);
  const back = page.getByRole("button", { name: "العودة إلى الآية الحالية" });
  await expect(back).toHaveCount(0);
  // Scrolling the text by hand does offer the way back.
  await page.locator(".scripture").dispatchEvent("wheel", { deltaY: 300 });
  await expect(back).toBeVisible();
});

test("media failures retry, final verse stops, and leaving reading releases audio", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/audio/days/*.m4a", (route) =>
    fail
      ? route.fulfill({ status: 503, body: "unavailable" })
      : route.fallback(),
  );
  await openPlayer(page);
  await expect(page.getByRole("alert")).toContainText("تعذر تشغيل التسجيل");
  fail = false;
  await page.getByRole("button", { name: "حاول مرة أخرى" }).click();
  await expect(
    page.getByRole("button", { name: "إيقاف مؤقت", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime),
    )
    .toBeGreaterThan(0);
  await page.locator("audio").evaluate((el: HTMLAudioElement) => {
    el.currentTime = el.duration - 0.15;
  });
  await expect(page.getByText("انتهى التسجيل", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "الآية التالية", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("article")).toHaveAttribute("data-day", "1");
  await expect(
    page.getByRole("button", { name: "تمت القراءة", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "تشغيل التسجيل", exact: true })
    .click();
  await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.paused),
    )
    .toBe(true);
  await page.getByRole("button", { name: MODES.bible, exact: true }).click();
  await expect(page.locator("audio")).toHaveCount(0);
});

test("slow or failed player code gives visible feedback and navigation recovers", async ({
  page,
}) => {
  const gate = createGate();
  await page.route("**/assets/AudioPlayer-*.js", async (route) => {
    await gate.opened;
    await route.fulfill({ status: 503, body: "unavailable" });
  });
  await page.goto("/?day=1");
  await ready(page);
  await page.getByRole("button", { name: "استمع إلى قراءة اليوم" }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText("جارٍ فتح المشغل");
  await expect(status).toBeInViewport();
  gate.open();
  await expect(page.getByRole("alert")).toBeInViewport();
  await expect(page.getByRole("alert")).toContainText("تعذر فتح هذا الجزء");
  await page.getByRole("button", { name: "اليوم التالي", exact: true }).click();
  await expect(page.getByRole("article")).toHaveAttribute("data-day", "2");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("with «متابعة», a finished day continues to the next day's recording", async ({
  page,
}) => {
  test.skip(
    process.env.AUDIO_TEST_FIXTURES !== "1",
    "Needs the accelerated fixture recordings",
  );
  await openPlayer(page);
  const end = page.getByRole("button", { name: /^عند الانتهاء:/ });
  await end.click();
  await expect(end).toHaveAccessibleName("عند الانتهاء: متابعة إلى التالي");
  await page.locator("audio").evaluate((el: HTMLAudioElement) => {
    el.currentTime = el.duration - 0.15;
  });
  await expect(page.getByRole("article")).toHaveAttribute("data-day", "2", {
    timeout: 10000,
  });
  await expect(page.locator("audio")).toHaveAttribute(
    "src",
    /\/audio\/days\/002-.+\.m4a/,
  );
  await expect
    .poll(() =>
      page.locator("audio").evaluate((el: HTMLAudioElement) => el.paused),
    )
    .toBe(false);
});
