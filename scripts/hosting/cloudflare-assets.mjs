// Inspect every shipped asset before and after the build, including bounded
// gzip decoding and credential checks. No deployment commands run here.
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { usfmCodes } from "../lib/books.js";
import { ROOT } from "../lib/paths.js";
import { fail } from "./cloudflare-policy.mjs";

// The word-range limits of src/features/study/domain/limits.ts, kept here as plain
// numbers: Workers Builds runs this file with plain `node`, which may lack
// TypeScript support, so nothing on the deploy path imports a .ts module.
// tests/integration/cloudflare-app.test.ts fails if the two copies differ.
export const STUDY_WORDS_GZIP_LIMIT = 30000;
export const STUDY_WORDS_RAW_LIMIT = 256 * 1024;

export function files(root) {
  if (!existsSync(root)) return [];
  if (lstatSync(root).isSymbolicLink())
    fail("symlinks are forbidden in assets");
  if (!lstatSync(root).isDirectory()) return [root];
  return readdirSync(root).flatMap((name) => files(join(root, name)));
}

// The committed redirect rules, or undefined in a checkout without them.
export function committedRedirects(root) {
  const path = join(root, "hosting/cloudflare-app/_redirects");
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

const studyBooks = usfmCodes(ROOT);
const studyWordsPath =
  /^study\/v2\/([1-3]?[A-Z]{2,3})\/([1-9]\d*)\/([1-9]\d*)-([1-9]\d*)\.words\.json\.gz$/;

/** Only the generated study word format may use compressed app assets. */
function studyWordsBody(body, match) {
  // The same limits as the app's decoder, checked here independently: the
  // stored size, then a bounded decode of the actual bytes.
  if (body.length > STUDY_WORDS_GZIP_LIMIT)
    fail("compressed study words exceed request budget");
  let decoded, data;
  try {
    decoded = gunzipSync(body, { maxOutputLength: STUDY_WORDS_RAW_LIMIT });
    data = JSON.parse(decoded.toString("utf8"));
  } catch {
    fail("invalid or oversized compressed study words");
  }
  const [, book, chapter, start, end] = match;
  if (
    !data ||
    !studyBooks.has(book) ||
    data.v !== 2 ||
    data.book !== book ||
    data.chapter !== Number(chapter) ||
    data.start !== Number(start) ||
    data.end !== Number(end) ||
    data.end < data.start ||
    !data.verses ||
    typeof data.verses !== "object" ||
    Array.isArray(data.verses) ||
    Object.keys(data.verses).length !== data.end - data.start + 1 ||
    Object.entries(data.verses).some(
      ([number, entry]) =>
        !/^[1-9]\d*$/.test(number) ||
        Number(number) < data.start ||
        Number(number) > data.end ||
        !entry ||
        !Array.isArray(entry.w),
    )
  )
    fail("compressed study words do not match their asset identity");
  return decoded;
}

/**
 * @param {string} [redirects] the committed _redirects a shipped copy must equal
 */
export function scanAssets(root, env = process.env, redirects) {
  const paths = files(root);
  if (paths.length > 10_000) fail("app assets exceed the 10,000-file budget");
  let bytes = 0;
  const secrets = Object.entries(env)
    .filter(
      ([key, value]) =>
        /KEY|TOKEN|SECRET|PASSWORD/i.test(key) &&
        value?.length >= 12 &&
        key !== "VITE_TURNSTILE_SITE_KEY",
    )
    .map(([, value]) => value);
  for (const file of paths) {
    const size = lstatSync(file).size;
    bytes += size;
    if (size > 8 * 1024 * 1024 || bytes > 64 * 1024 * 1024)
      fail("app assets exceed the 8 MiB/file or 64 MiB total budget");
    if (/\.(?:m4a|mp3|mp4|wav|ogg|opus|aac|flac|webm)$/i.test(file))
      fail("audio/video binaries are forbidden in app assets");
    if (
      /(?:^|\/)\.(?:env(?:\..*)?|dev\.vars(?:\..*)?)$/.test(file) ||
      /\.(?:pem|key)$/i.test(file)
    )
      fail("environment or private-key files are forbidden in app assets");
    const studyMatch = studyWordsPath.exec(
      relative(root, file).replaceAll("\\", "/"),
    );
    if (
      !studyMatch &&
      !/^(?:\.html|\.json|\.js|\.css|\.txt|\.svg|\.png|\.jpe?g|\.webp|\.avif|\.ico|\.woff2?)$/i.test(
        extname(file),
      ) &&
      !["_headers", "_redirects"].includes(relative(root, file))
    )
      fail("unexpected file type in app assets");
    if (
      relative(root, file) === "_redirects" &&
      readFileSync(file, "utf8") !== redirects
    )
      fail("_redirects differs from hosting/cloudflare-app/_redirects");
    if (relative(root, file).startsWith("audio/") && extname(file) !== ".json")
      fail("only generated JSON manifests may be shipped under audio/");
    const raw = readFileSync(file);
    const body = studyMatch ? studyWordsBody(raw, studyMatch) : raw;
    const text = body.toString("utf8");
    const rest = text;
    if (
      secrets.some((value) => body.includes(value)) ||
      /sk-or-v1-[a-zA-Z0-9_-]+|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(
        rest,
      )
    )
      fail("a credential was detected in app assets (value redacted)");
  }
}
