import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  AUDIO_CACHE_CONTROL,
  AUDIO_CONTENT_TYPE,
  AUDIO_R2_BUCKET,
} from "../src/audio/contract.ts";

/** Retries after the first attempt of one batch. */
export const UPLOAD_RETRIES = 3;

/** The wrangler arguments that put one batch file into the bucket. */
export function bulkPutArguments(batch) {
  return [
    "wrangler@4",
    "r2",
    "bulk",
    "put",
    AUDIO_R2_BUCKET,
    "--filename",
    batch,
    "--content-type",
    AUDIO_CONTENT_TYPE,
    "--cache-control",
    AUDIO_CACHE_CONTROL,
    "--remote",
    "--concurrency",
    "20",
  ];
}

/** `batch-NN.json` files in order. */
export function listBatches(dir) {
  return readdirSync(dir)
    .filter((name) => /^batch-\d+\.json$/.test(name))
    .sort()
    .map((name) => resolve(dir, name));
}

/**
 * Uploads each batch in its own wrangler process: an OAuth token that expires
 * mid-run then costs one batch, not the release. Re-putting a batch stores the
 * same immutable bytes under the same keys. Stops at the first batch that still
 * fails after its retries and returns the batches uploaded so far.
 *
 * @param {string[]} batches
 * @param {{ run?: (args: string[]) => number | null; log?: (line: string) => void }} options
 */
export function runUploads(
  batches,
  {
    run = (args) =>
      spawnSync("npx", args, {
        stdio: "inherit",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      }).status,
    log = console.log,
  } = {},
) {
  const uploaded = [];
  for (const batch of batches) {
    let status = null;
    for (let attempt = 0; attempt <= UPLOAD_RETRIES; attempt += 1) {
      if (attempt) log(`Retry ${attempt}/${UPLOAD_RETRIES}: ${batch}`);
      status = run(bulkPutArguments(batch));
      if (status === 0) break;
    }
    if (status !== 0) {
      log(
        `Upload stopped: ${batch} failed after ${UPLOAD_RETRIES} retries. ` +
          `Fix the cause, then run again with --from ${uploaded.length + 1}.`,
      );
      return { uploaded, failed: batch };
    }
    uploaded.push(batch);
    log(`Uploaded ${batch} (${uploaded.length}/${batches.length}).`);
  }
  return { uploaded, failed: undefined };
}

// Uploads what `npm run audio:host:prepare` staged. Objects are immutable:
// this never deletes, and the batches hold only files not yet verified.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      dir: { type: "string", default: "artifacts/r2-audio-upload" },
      from: { type: "string", default: "1" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const batches = listBatches(resolve(values.dir)).slice(
    Math.max(0, Number(values.from) - 1),
  );
  if (!batches.length) {
    console.log(`No upload batches in ${values.dir}: nothing to upload.`);
  } else if (values["dry-run"]) {
    for (const batch of batches)
      console.log(
        ["npx", ...bulkPutArguments(batch)]
          .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
          .join(" "),
      );
  } else {
    const { failed } = runUploads(batches);
    if (failed) process.exitCode = 1;
    else
      console.log(
        "Uploaded. Now run scripts/verify-audio-host.py https://audio.chronosbible.com --publish.",
      );
  }
}
