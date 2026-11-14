import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  closeSheet,
  openAppearance,
  ready,
  recordRequests,
  stubConnection,
} from "./helpers";
import {
  POSITION_KEY,
  blockExternal,
  fulfillWav,
  mediaProbe,
  probeMedia,
  rejectNextPlay,
  sameMediaElement,
} from "./audioFixtures";
import type { AudioManifestV3 } from "../../src/features/audio/domain/types.ts";

// Chronological readings are v3 playlists: several immutable files played in
// order by one persistent <audio> element. The fixture build advertises every
// committed playlist; here they keep their real identity, text hash and cues
// but run seconds long, with synthetic WAV media and no external host.
test.skip(
  process.env.AUDIO_TEST_FIXTURES !== "1",
  "Needs the audio fixture build (npm run test:e2e)",
);

const playlist = (id: string, testament = "OT") =>
  JSON.parse(
    readFileSync(`data/audio/readings/${testament}/${id}.json`, "utf8"),
  ) as AudioManifestV3;

/** Each entry shrinks to `seconds`, keeping its cues in proportion. */
function accelerated(
  id: string,
  seconds: number,
  testament = "OT",
): AudioManifestV3 {
  const real = playlist(id, testament);
  const entries = real.entries.map((entry) => {
    const scale = seconds / entry.duration;
    const fit = <T extends { start: number; end: number }>(item: T) => ({
      ...item,
      start: +(item.start * scale).toFixed(3),
      end: +(item.end * scale).toFixed(3),
    });
    return {
      ...entry,
      duration: seconds,
      cues: entry.cues.map(fit),
      announcements: entry.announcements.map(fit),
    };
  });
  return {
    ...real,
    duration: +(seconds * entries.length).toFixed(3),
    entries,
  };
}

const sources = (id: string) => playlist(id).entries.map((e) => e.src);

async function route(
  page: Page,
  seconds: Record<string, number>,
  testament = "OT",
) {
  const external = await blockExternal(page);
  const served = new Map<string, number>();
  for (const [id, length] of Object.entries(seconds)) {
    const manifest = accelerated(id, length, testament);
    for (const entry of manifest.entries) served.set(entry.src, entry.duration);
    await page.route(`**/audio/chrono/${testament}/${id}.json`, (r) =>
      r.fulfill({ json: manifest }),
    );
  }
  await page.route("https://audio.example.test/audio/**/*.m4a", (r) => {
    const seconds = served.get(new URL(r.request().url()).pathname);
    return seconds === undefined
      ? r.fulfill({ status: 404 })
      : fulfillWav(r, seconds);
  });
  return { external };
}

const audio = (page: Page) => page.locator("audio");
const progress = (page: Page) =>
  page
    .getByRole("slider", { name: "موضع التسجيل" })
    .evaluate((el: HTMLInputElement) => Number(el.value));
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const listen = (page: Page) =>
  page.getByRole("button", { name: "استمع إلى القراءة", exact: true });
const alertBox = (page: Page) => page.getByRole("alert");
const open = async (page: Page, id: string) => {
  await page.goto(`/?mode=chronological&testament=OT&reading=${id}`);
  await ready(page);
};
const media = (path: string) => new URL(path, "https://x").pathname;
const filename = (src: string) => src.split("/").pop()!;

test("no media is requested before Listen; native ended moves through the playlist once", async ({
  page,
}) => {
  await probeMedia(page);
  const { external } = await route(page, { "gen-1-1": 2 });
  const requests = recordRequests(page, (path) => path.includes("/audio/"));
  await stubConnection(page, { saveData: true });
  await open(page, "gen-1-1");
  await page.waitForTimeout(700);
  expect(requests).toEqual([]);
  await expect(audio(page)).toHaveCount(0);
  await listen(page).click();
  const [first, second] = sources("gen-1-1");
  await expect(audio(page)).toHaveAttribute("src", new RegExp(filename(first)));
  await expect(page.getByText("انتهى التسجيل", { exact: true })).toBeVisible({
    timeout: 12000,
  });
  const { starts, ended } = await mediaProbe(page);
  expect(starts.map(([src]) => media(src))).toEqual([
    expect.stringContaining(filename(first)),
    expect.stringContaining(filename(second)),
  ]);
  expect(starts[1][1]).toBeLessThan(0.5);
  expect(ended.map(filename)).toEqual([filename(first), filename(second)]);
  expect(await sameMediaElement(page)).toBe(true);
  expect(await progress(page)).toBeCloseTo(4, 0);
  expect(
    requests.filter((path) => path.endsWith(".m4a")).map(filename),
  ).toEqual(expect.arrayContaining([filename(first), filename(second)]));
  expect(external).toEqual([]);
});

test("a rejected autoplay at the file switch pauses at once, keeps the place and retries on the same element", async ({
  page,
}) => {
  await probeMedia(page);
  await route(page, { "gen-1-1": 2 });
  await stubConnection(page, { saveData: true });
  await open(page, "gen-1-1");
  await listen(page).click();
  await expect.poll(async () => (await mediaProbe(page)).starts.length).toBe(1);
  // The browser refuses the play() that follows the first file's ended.
  await rejectNextPlay(page);
  await expect(button(page, "تشغيل التسجيل")).toBeVisible({ timeout: 8000 });
  const [, second] = sources("gen-1-1");
  await expect(audio(page)).toHaveAttribute(
    "src",
    new RegExp(filename(second)),
  );
  // Immediate paused/retry, not a 20 second wait and not an error.
  await expect(alertBox(page)).toHaveCount(0);
  await expect(page.getByText("جارٍ تحميل التسجيل…")).toHaveCount(0);
  expect(await progress(page)).toBeCloseTo(2, 0);
  expect((await mediaProbe(page)).starts).toHaveLength(1);
  await button(page, "تشغيل التسجيل").click();
  await expect.poll(async () => (await mediaProbe(page)).starts.length).toBe(2);
  expect((await mediaProbe(page)).starts[1][0]).toContain(filename(second));
  expect(await sameMediaElement(page)).toBe(true);
  await expect(page.getByText("انتهى التسجيل", { exact: true })).toBeVisible({
    timeout: 8000,
  });
  // One normal play per file plus the rejected one and its retry; no extras.
  expect((await mediaProbe(page)).plays).toBe(3);
  expect((await mediaProbe(page)).ended).toHaveLength(2);
});

test("a failed second file shows retry at its place; seek, speed and resume survive file switches", async ({
  page,
}) => {
  await probeMedia(page);
  await route(page, { "gen-5-1": 3 });
  await stubConnection(page, { saveData: true });
  const [, clip] = sources("gen-5-1");
  let fail = true;
  await page.route(`**/${filename(clip)}`, (r) =>
    fail ? r.fulfill({ status: 503, body: "down" }) : r.fallback(),
  );
  await open(page, "gen-5-1");
  await listen(page).click();
  await expect(alertBox(page)).toContainText("تعذر تشغيل التسجيل", {
    timeout: 8000,
  });
  expect(await progress(page)).toBeCloseTo(3, 0);
  fail = false;
  await page.getByRole("button", { name: "حاول مرة أخرى" }).click();
  await expect(alertBox(page)).toHaveCount(0);
  await expect.poll(async () => (await mediaProbe(page)).starts.length).toBe(2);
  expect((await mediaProbe(page)).starts[1][0]).toContain(filename(clip));
  expect(await sameMediaElement(page)).toBe(true);

  // Speed is kept when the next file loads (loading resets playbackRate).
  await page.getByRole("button", { name: /^سرعة القراءة:/ }).click();
  const rate = await audio(page).evaluate(
    (el: HTMLAudioElement) => el.playbackRate,
  );
  expect(rate).not.toBe(1);
  const last = sources("gen-5-1")[2];
  await expect(audio(page)).toHaveAttribute("src", new RegExp(filename(last)), {
    timeout: 8000,
  });
  expect(
    await audio(page).evaluate((el: HTMLAudioElement) => el.playbackRate),
  ).toBe(rate);
  expect(await sameMediaElement(page)).toBe(true);
  // Verse skip back from the last file lands in the clip: a file switch.
  await button(page, "إيقاف مؤقت").click();
  await page.getByRole("slider", { name: "موضع التسجيل" }).fill("6");
  await button(page, "الآية السابقة").click();
  await expect(audio(page)).toHaveAttribute("src", new RegExp(filename(clip)));
  expect(
    await audio(page).evaluate((el: HTMLAudioElement) => el.playbackRate),
  ).toBe(rate);
  expect(await progress(page)).toBeGreaterThanOrEqual(3);
  await button(page, "تشغيل التسجيل").click();
  await expect(button(page, "إيقاف مؤقت")).toBeVisible();
  expect(await sameMediaElement(page)).toBe(true);

  // Resume: reopening continues inside the clip, not at the start.
  await button(page, "إيقاف مؤقت").click();
  const saved = await page.evaluate(
    (key) => Object.values(JSON.parse(localStorage.getItem(key) || "{}")),
    POSITION_KEY,
  );
  expect(saved[0]).toBeGreaterThanOrEqual(3);
  await page.reload();
  await ready(page);
  await listen(page).click();
  await expect(audio(page)).toHaveAttribute("src", new RegExp(filename(clip)));
  await expect
    .poll(() => progress(page))
    .toBeGreaterThanOrEqual(saved[0] as number);
});

test("manual navigation stops and releases the playlist", async ({ page }) => {
  await probeMedia(page);
  await route(page, { "gen-1-1": 6 });
  await stubConnection(page, { saveData: true });
  await open(page, "gen-1-1");
  await listen(page).click();
  await expect.poll(async () => (await mediaProbe(page)).starts.length).toBe(1);
  await button(page, "القراءة التالية").click();
  await ready(page);
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "chrono:OT:gen-3-1",
  );
  await expect(audio(page)).toHaveCount(0);
  // The old playlist never starts a second file after navigation.
  await page.waitForTimeout(1000);
  expect((await mediaProbe(page)).starts).toHaveLength(1);
});

test("the next playlist's timing is prefetched as metadata only", async ({
  page,
}) => {
  await probeMedia(page);
  await route(page, { "gen-1-1": 5, "gen-3-1": 3 });
  const requests = recordRequests(page, (path) => path.includes("/audio/"));
  await open(page, "gen-1-1");
  const settings = await openAppearance(page);
  await settings
    .getByRole("checkbox", { name: "استماع متواصل" })
    .setChecked(true);
  await closeSheet(page);
  await listen(page).click();
  await expect
    .poll(() => requests.includes("/audio/chrono/OT/gen-3-1.json"))
    .toBe(true);
  expect(
    requests.filter((path) => path.endsWith(".m4a")).map(filename),
  ).toEqual(expect.not.arrayContaining(sources("gen-3-1").map(filename)));
  // At the end the continuation plays on the next reading.
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "chrono:OT:gen-3-1",
    { timeout: 20000 },
  );
  await expect(audio(page)).toHaveAttribute(
    "src",
    new RegExp(filename(sources("gen-3-1")[0])),
  );
});

for (const connection of [
  { saveData: true },
  { effectiveType: "2g" },
  { effectiveType: "slow-2g" },
]) {
  test(`no prefetch on ${JSON.stringify(connection)}`, async ({ page }) => {
    await route(page, { "gen-1-1": 5, "gen-3-1": 3 });
    await stubConnection(page, connection);
    const requests = recordRequests(page, (path) => path.includes("/audio/"));
    await open(page, "gen-1-1");
    const settings = await openAppearance(page);
    await settings
      .getByRole("checkbox", { name: "استماع متواصل" })
      .setChecked(true);
    await closeSheet(page);
    await listen(page).click();
    await expect(audio(page)).toHaveAttribute("src", /\.m4a/);
    await expect
      .poll(
        async () =>
          await audio(page).evaluate((el: HTMLAudioElement) => el.currentTime),
      )
      .toBeGreaterThan(0.3);
    await page.waitForTimeout(1000);
    expect(requests).not.toContain("/audio/chrono/OT/gen-3-1.json");
    expect(requests.filter((path) => path.includes("gen-3-1"))).toEqual([]);
  });
}

for (const [testament, id] of [
  ["OT", "exo-1-1"],
  ["NT", "mrk-12-13"],
]) {
  test(`${testament} passages highlight their exact verses after seeking across files`, async ({
    page,
  }) => {
    await route(page, { [id]: 10 }, testament);
    await page.goto(
      `/?mode=chronological&testament=${testament}&reading=${id}`,
    );
    await ready(page);
    await listen(page).click();
    await expect(button(page, "إيقاف مؤقت")).toBeVisible();
    await button(page, "إيقاف مؤقت").click();
    const manifest = accelerated(id, 10, testament);
    for (const [index, entry] of manifest.entries.entries()) {
      const relative = Math.ceil(entry.cues[0].start + 0.01);
      const cue = [...entry.cues].reverse().find((c) => c.start <= relative)!;
      const time = index * 10 + relative;
      await page
        .getByRole("slider", { name: "موضع التسجيل" })
        .fill(String(time));
      await expect(
        page.locator(
          `#passage-${entry.passage} [data-listening][data-v="${cue.verse}"]`,
        ),
      ).toHaveCount(1);
      await expect(page.locator("[data-listening]")).toHaveCount(1);
    }
  });
}
