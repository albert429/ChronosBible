import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import type { AudioManifestV2 } from "../../src/features/audio/domain/types.ts";

export const POSITION_KEY = "bible-reader-audio-position-v1";

/** Accelerated timing for one chapter's committed manifest. */
export type ChapterTiming = {
  /** Seconds of the recording's own opening (verse-timed chapters). */
  opening?: number;
  /** Seconds per verse cue, including a short gap (verse-timed chapters). */
  verse?: number;
  /** Total seconds of a synthetic chapter-level recording. */
  duration?: number;
  chapterOnly?: boolean;
  /** Replace the immutable media path, as a rebuilt recording would. */
  src?: string;
  /** Replace the transcript fingerprint, as a stale manifest would. */
  readingHash?: string;
};

export const committedChapter = (book: string, chapter: number) =>
  JSON.parse(
    readFileSync(`data/audio/chapters/${book}/${chapter}.json`, "utf8"),
  ) as AudioManifestV2;

/** The committed manifest with the same identity, text hash and kinds of timing, but seconds long. */
export function acceleratedChapter(
  book: string,
  chapter: number,
  timing: ChapterTiming = {},
): AudioManifestV2 {
  const real = committedChapter(book, chapter);
  const base = {
    ...real,
    src: timing.src ?? real.src,
    readingHash: timing.readingHash ?? real.readingHash,
  };
  if (timing.chapterOnly || real.alignment === "chapter")
    return {
      ...base,
      alignment: "chapter",
      cues: [],
      announcements: [],
      duration: timing.duration ?? 1.2,
    };
  const opening = real.announcements.length ? (timing.opening ?? 0.3) : 0;
  const step =
    timing.verse ??
    (timing.duration
      ? (timing.duration - opening - 0.1) / real.cues.length
      : 0.2);
  const cues = real.cues.map((cue, index) => ({
    ...cue,
    start: +(opening + index * step).toFixed(3),
    end: +(opening + index * step + step * 0.75).toFixed(3),
  }));
  return {
    ...base,
    duration: +(opening + cues.length * step + 0.1).toFixed(3),
    cues,
    announcements: real.announcements.map((announcement) => ({
      ...announcement,
      start: 0,
      end: opening,
    })),
  };
}

/** A silent 8kHz WAV of `seconds`, honouring single byte ranges. */
export function fulfillWav(route: Route, seconds: number) {
  const size = Math.round(8000 * seconds);
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
  return route.fulfill({
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
}

/**
 * Abort every request leaving 127.0.0.1 and list it, so a test can prove that
 * no CDN or recording host was reached. Register it before specific routes:
 * later routes take precedence.
 */
export async function blockExternal(page: Page) {
  const external: string[] = [];
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => {
      external.push(route.request().url());
      return route.abort();
    },
  );
  return external;
}

export type MediaProbe = {
  /** Every native start: the source and position it started at. */
  starts: [string, number][];
  /** The source of every native `ended`. */
  ended: string[];
  /** The first media element that played. */
  first: Element | null;
  /** Reject the next play() as a browser refusing autoplay would. */
  rejectNext: boolean;
  plays: number;
};
/** From page load, record every media start and end, and count play() calls. */
export async function probeMedia(page: Page) {
  await page.addInitScript(() => {
    const state: MediaProbe = {
      starts: [],
      ended: [],
      first: null,
      rejectNext: false,
      plays: 0,
    };
    Object.assign(window, { __media: state });
    // Media events do not bubble, but a capturing document listener sees them.
    document.addEventListener(
      "playing",
      (event) => {
        const element = event.target as HTMLAudioElement;
        state.first ??= element;
        state.starts.push([element.currentSrc, element.currentTime]);
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
type Probed = { __media: MediaProbe };
export const mediaProbe = (page: Page) =>
  page.evaluate(() => (window as unknown as Probed).__media);
export const rejectNextPlay = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as Probed).__media.rejectNext = true;
  });
/** Whether the audio element now on the page is the first one that played. */
export const sameMediaElement = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector("audio") ===
      (window as unknown as Probed).__media.first,
  );

/**
 * Serve accelerated chapter manifests and synthetic media for the fixture
 * build (VITE_AUDIO_BASE_URL=https://audio.example.test). Every other request
 * leaving 127.0.0.1 is aborted and listed in `external` (`blockExternal`).
 */
export async function routeChapterAudio(
  page: Page,
  timings: Record<string, ChapterTiming> = {},
) {
  // Registered first, so the specific routes below take precedence.
  const external = await blockExternal(page);
  const served = new Map<string, AudioManifestV2>();
  await page.route("**/audio/chapters/*/*.json", (route) => {
    const [book, file] = new URL(route.request().url()).pathname
      .split("/")
      .slice(-2);
    const chapter = Number(file.replace(".json", ""));
    const manifest = acceleratedChapter(
      book,
      chapter,
      timings[`${book}:${chapter}`],
    );
    served.set(manifest.src, manifest);
    return route.fulfill({ json: manifest });
  });
  await page.route(
    "https://audio.example.test/audio/chapters/assets/*.m4a",
    (route) => {
      const { pathname } = new URL(route.request().url());
      const manifest = served.get(pathname);
      if (!manifest) return route.fulfill({ status: 404 });
      return fulfillWav(route, manifest.duration);
    },
  );
  return { external, served };
}

/**
 * A committed daily manifest rebuilt as scripts/build-audio.py --announcements
 * would lay it out: a spoken reference before every passage, then its verses.
 * The draft reference wording is display data only here.
 */
export function announcedDay(day: number, reference = 2, verse = 2) {
  const legacy = JSON.parse(
    readFileSync(`data/audio/manifests/${day}.json`, "utf8"),
  );
  const plan = JSON.parse(readFileSync("data/plan.json", "utf8"));
  const books = new Map<string, string>(
    JSON.parse(readFileSync("data/books.json", "utf8")).map((row: string[]) => [
      row[3],
      row[0],
    ]),
  );
  const texts = new Map<string, string>(
    JSON.parse(
      readFileSync("data/audio/reference-texts.json", "utf8"),
    ).references.map((r: { id: string; text: string }) => [r.id, r.text]),
  );
  type Passage = { book: string; chapter: number; start: number; end: number };
  const passages: Passage[] = plan[day - 1].passages;
  let time = 0;
  const cues: { passage: number; verse: number; start: number; end: number }[] =
    [];
  const announcements = passages.map((passage, index) => {
    const id = `${books.get(passage.book)}-${passage.chapter}-${passage.start}-${passage.end}`;
    const announcement = {
      passage: index,
      start: time,
      end: time + reference,
      reference: texts.get(id)!.replace(/\.$/, ""),
      kind: "reference" as const,
    };
    time += reference;
    for (const cue of legacy.cues.filter(
      (cue: { passage: number }) => cue.passage === index,
    )) {
      cues.push({ ...cue, start: time, end: time + verse * 0.8 });
      time += verse;
    }
    return announcement;
  });
  return {
    ...legacy,
    version: 2,
    identity: `plan:${day}`,
    duration: time + 0.1,
    alignment: "verse",
    cues,
    announcements,
  };
}
