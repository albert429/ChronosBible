import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  closeSheet,
  openAppearance,
  ready,
  recordRequests,
  stubConnection,
} from "./helpers";
import { POSITION_KEY, fulfillWav } from "./chapterAudio";
import type { AudioManifestV3 } from "../../src/audio/manifest.ts";

// Chronological readings are v3 playlists: several immutable files played in
// order by one persistent <audio> element. The fixture build advertises every
// committed playlist; here they keep their real identity, text hash and cues
// but run seconds long, with synthetic WAV media and no external host.
test.skip(
  process.env.AUDIO_TEST_FIXTURES !== "1",
  "Needs the audio fixture build (npm run test:e2e)",
);

const playlist = (id: string) =>
  JSON.parse(
    readFileSync(`data/audio/readings/OT/${id}.json`, "utf8"),
  ) as AudioManifestV3;

/** Each entry shrinks to `seconds`, keeping its cues in proportion. */
function accelerated(id: string, seconds: number): AudioManifestV3 {
  const real = playlist(id);
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

async function route(page: Page, seconds: Record<string, number>) {
  const external: string[] = [];
  const served = new Map<string, number>();
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (r) => {
      external.push(r.request().url());
      return r.abort();
    },
  );
  for (const [id, length] of Object.entries(seconds)) {
    const manifest = accelerated(id, length);
    for (const entry of manifest.entries) served.set(entry.src, entry.duration);
    await page.route(`**/audio/chrono/OT/${id}.json`, (r) =>
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

type Probe = {
  starts: [string, number][];
  ended: string[];
  first: Element | null;
  rejectNext: boolean;
  plays: number;
};
/** Record every native start and end; optionally reject the next play(). */
async function probe(page: Page) {
  await page.addInitScript(() => {
    const state = {
      starts: [],
      ended: [],
      first: null,
      rejectNext: false,
      plays: 0,
    } as Probe;
    Object.assign(window, { __probe: state });
    document.addEventListener(
      "playing",
      (event) => {
        const el = event.target as HTMLAudioElement;
        state.first ??= el;
        state.starts.push([el.currentSrc, el.currentTime]);
      },
      true,
    );
    document.addEventListener(
      "ended",
      (event) => state.ended.push((event.target as HTMLAudioElement).src),
      true,
    );
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      state.plays += 1;
      if (state.rejectNext) {
        state.rejectNext = false;
        return Promise.reject(new DOMException("blocked", "NotAllowedError"));
      }
      return play.call(this);
    };
  });
}
const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { __probe: Probe }).__probe);
const arm = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __probe: Probe }).__probe.rejectNext = true;
  });
const sameElement = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector("audio") ===
      (window as unknown as { __probe: Probe }).__probe.first,
  );

const audio = (page: Page) => page.locator("audio");
const progress = (page: Page) =>
  page
    .getByRole("progressbar", { name: "تقدم التسجيل" })
    .evaluate((el: HTMLProgressElement) => el.value);
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
  await probe(page);
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
  const { starts, ended } = await state(page);
  expect(starts.map(([src]) => media(src))).toEqual([
    expect.stringContaining(filename(first)),
    expect.stringContaining(filename(second)),
  ]);
  expect(starts[1][1]).toBeLessThan(0.5);
  expect(ended.map(filename)).toEqual([filename(first), filename(second)]);
  expect(await sameElement(page)).toBe(true);
  expect(await progress(page)).toBeCloseTo(4, 0);
  expect(
    requests.filter((path) => path.endsWith(".m4a")).map(filename),
  ).toEqual(expect.arrayContaining([filename(first), filename(second)]));
  expect(external).toEqual([]);
});

test("a rejected autoplay at the file switch pauses at once, keeps the place and retries on the same element", async ({
  page,
}) => {
  await probe(page);
  await route(page, { "gen-1-1": 2 });
  await stubConnection(page, { saveData: true });
  await open(page, "gen-1-1");
  await listen(page).click();
  await expect.poll(async () => (await state(page)).starts.length).toBe(1);
  // The browser refuses the play() that follows the first file's ended.
  await arm(page);
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
  expect((await state(page)).starts).toHaveLength(1);
  await button(page, "تشغيل التسجيل").click();
  await expect.poll(async () => (await state(page)).starts.length).toBe(2);
  expect((await state(page)).starts[1][0]).toContain(filename(second));
  expect(await sameElement(page)).toBe(true);
  await expect(page.getByText("انتهى التسجيل", { exact: true })).toBeVisible({
    timeout: 8000,
  });
  // One normal play per file plus the rejected one and its retry; no extras.
  expect((await state(page)).plays).toBe(3);
  expect((await state(page)).ended).toHaveLength(2);
});

test("a failed second file shows retry at its place; seek, speed and resume survive file switches", async ({
  page,
}) => {
  await probe(page);
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
  await expect.poll(async () => (await state(page)).starts.length).toBe(2);
  expect((await state(page)).starts[1][0]).toContain(filename(clip));
  expect(await sameElement(page)).toBe(true);

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
  expect(await sameElement(page)).toBe(true);
  // Verse skip back from the last file lands in the clip: a file switch.
  await button(page, "إيقاف مؤقت").click();
  await button(page, "الآية السابقة").click();
  await expect(audio(page)).toHaveAttribute("src", new RegExp(filename(clip)));
  expect(
    await audio(page).evaluate((el: HTMLAudioElement) => el.playbackRate),
  ).toBe(rate);
  expect(await progress(page)).toBeGreaterThanOrEqual(3);
  await button(page, "تشغيل التسجيل").click();
  await expect(button(page, "إيقاف مؤقت")).toBeVisible();
  expect(await sameElement(page)).toBe(true);

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
  await probe(page);
  await route(page, { "gen-1-1": 6 });
  await stubConnection(page, { saveData: true });
  await open(page, "gen-1-1");
  await listen(page).click();
  await expect.poll(async () => (await state(page)).starts.length).toBe(1);
  await button(page, "القراءة التالية").click();
  await ready(page);
  await expect(page.getByRole("article")).toHaveAttribute(
    "data-reading",
    "chrono:OT:gen-3-1",
  );
  await expect(audio(page)).toHaveCount(0);
  // The old playlist never starts a second file after navigation.
  await page.waitForTimeout(1000);
  expect((await state(page)).starts).toHaveLength(1);
});

test("the next playlist's timing is prefetched as metadata only", async ({
  page,
}) => {
  await probe(page);
  await route(page, { "gen-1-1": 5, "gen-3-1": 3 });
  const requests = recordRequests(page, (path) => path.includes("/audio/"));
  await open(page, "gen-1-1");
  const settings = await openAppearance(page);
  await settings
    .getByRole("checkbox", { name: "استماع متواصل للإصحاحات" })
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
      .getByRole("checkbox", { name: "استماع متواصل للإصحاحات" })
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
