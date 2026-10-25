# Static audio delivery

The plan reader plays a single audio file for each day; the Bible reader plays one
file per chapter; a chronological reading plays a playlist of chapters and clips.
The recordings keep their own native introductions; no spoken labels are generated. All source selection, verse alignment, trimming, and encoding
happen offline. The reader is a static frontend
with no audio API, runtime secret, or speech model. The current Cloudflare Pages
audio host uses a small byte-range handler for native seeking.

## Source and preparation

The supplied download has 260 chapter MP3s (639 MB). Its embedded metadata says
**Arabic Van Dyck — Audio Drama**, © 1996 Bible Society of Egypt, **℗ 2008
Hosanna / Faith Comes By Hearing**. Despite the folder name, the filenames end in
`ARZVDVN1DA`. Identify the source by its actual metadata and hashes; do not infer
a narrator from the filenames. This is not verified as the Adel Nashy recording.

The recordings are user-supplied copyrighted material, separate from the public
domain eBible text. Neither the repository nor a public download grants permission
to redistribute or edit them. Keep the original attribution and obtain any
required permission before public distribution. No audio files are committed to Git.

An isolated Python 3.12 environment needs `torch==2.8.0`, `torchaudio==2.8.0`,
`uroman==1.3.1`, and NumPy. FFmpeg and FFprobe must be on PATH. Alignment downloads
the MMS_FA model once and runs locally on MPS when available, otherwise CPU.
The pinned TorchAudio version is intentional: newer versions remove its alignment API.

For example, with `uv` installed:

```sh
uv venv --python 3.12 artifacts/audio-work/venv
uv pip install --python artifacts/audio-work/venv/bin/python \
  torch==2.8.0 torchaudio==2.8.0 uroman==1.3.1 numpy
artifacts/audio-work/venv/bin/python scripts/align-audio.py /path/to/Arabic_arb_VDV_NT_Drama
python3 scripts/build-audio.py /path/to/Arabic_arb_VDV_NT_Drama
npm run build
```

Alignment results are resumable under `data/audio/alignments/`, which is committed (timings only, no audio). For a pilot,
use `--chapters MAT:1,MRK:1,LUK:1,LUK:2,JHN:1` on alignment and `--days 1,2,3`
on assembly. They contain machine-generated timestamps and confidence scores,
**not a claim of manual verification**. Listen to passage boundaries and review
low-confidence verses before publication. The initial eight flagged verses are
listed in [audio provenance](../data/audio/SOURCES.md). Edit the relevant chapter timing JSON
and reassemble affected days when correcting timings.

Assembly retains the exact passage order, including repeated passages. Each day
has a SHA-256 fingerprint of the displayed Scripture and a cue for each verse.
The player refuses mismatched/stale manifests. Updating Scripture requires
regenerating affected audio before those manifests can be built again.

Generated output:

- `data/audio/manifests/`: compact timing manifests, suitable for Git.
- `data/audio/catalog.json`: days for which audio has been prepared.
- `public/audio/days/`: encoded audio, ignored by Git.
- `public/audio/*.json`: copies of the timing manifests, written by `npm run build` (`scripts/build-data.js`), not by `build-audio.py`.

## Canonical chapters (Bible mode)

`scripts/build-canonical-audio.py --ot <OT folder> --nt <NT folder>` encodes each of
the 1,189 original chapter recordings once, whole, with the same settings. It
checks the exact 929 + 260 source coverage, reuses the verified NT alignments,
and never invents verse timing: chapters without an alignment get
`"alignment": "chapter"` and no cues. Output:

- `data/audio/chapters/<USFM>/<n>.json`: version-2 manifests (`identity`
  `bible:<USFM>:<n>`, `alignment`, `cues`, `announcements`), published by the build
  to `/audio/chapters/<USFM>/<n>.json`.
- `data/audio/chapter-catalog.json` and `canonical-sources.json`: the published
  chapters and their provenance (source name and SHA-256, size, duration).
- `/audio/chapters/assets/<USFM>-<n>-<hash>.m4a`: encoded media, outside Git.

An original that also contains another chapter gets a reviewed **source trim**
in `data/audio/source-trims.json` (today only Job 36, whose file continues
with all of Job 37; the cut was corrected and re-derived from the reviewed
evidence rather than taken from an earlier estimate). Each trim names its evidence, a forced alignment of the
whole original against both chapters' text; the build re-derives the cut (the
midpoint between the last kept verse and the first appended one) and checks
the original's SHA-256, both transcripts, appended scores >= 0.30, that the
appended chapter runs to the end, and that ffmpeg detects silence at the cut.
The trim end enters the immutable name and the provenance record
(`trimEnd`), and the review and clip builder treat it as the recording's end.
Rebuild one chapter without touching the others with
`--chapters JOB:36 --output <media root>/audio` (only that provenance record
changes). The superseded asset is listed as `supersedes` for rollback.

Check everything with
`python3 scripts/verify-canonical-audio.py --media <folder with audio/chapters/assets>... --ot <OT> --nt <NT>`
(several media roots allowed, first match wins).
Current state and the OT alignment benchmark are in
[audio provenance](../data/audio/SOURCES.md#canonical-chapter-audio). The
alignment script takes `--testament OT|NT|all`; a full OT run takes about 2.4 hours
on an Apple-silicon Mac and still needs listening review before publication.

Keep the 2.2 GB of chapter media outside `public/` (Vite copies `public/` into
every local build) and point `AUDIO_MEDIA_ROOT` at it when preparing the host.

## Chronological readings (version-3 playlists)

A chronological reading is several passages, so it is one **playlist** manifest
(`data/audio/readings/<OT|NT>/<id>.json`, published at
`/audio/chrono/<OT|NT>/<id>.json`; `data/audio/reading-catalog.json` lists the
complete ones). Each entry carries its own immutable `src`, `duration`, cues
and reference; the player lays them on one timeline and the browser's native
`ended` event moves from file to file (no timers). The reading hash covers the
displayed passages, so a changed text or chronology makes the manifest stale
and the player refuses it.

`scripts/build-reading-audio.py --chronology <public/chronology> --ot <OT> --nt <NT>`
builds them offline, resume-safe and deterministic:

- A passage that is a whole chapter reuses that chapter's published file and
  timing unchanged.
- A partial chapter becomes a **clip** `/audio/clips/<USFM>-<ch>-<from>-<to>-<hash>.m4a`
  cut from the **original** recording (not from the canonical AAC) with the
  canonical encoding. The cut is 0.25 s outside the verses, never past the
  midpoint of the silence shared with the neighbouring verse. Identical ranges
  share one file; the name fingerprints source, text, settings and cut points.
- Alignments are validated when the builder loads them (original name and
  SHA-256, transcript hash of the current text, complete ordered verses
  inside the recording or its trim), and the file's SHA-256 must be one the
  review summaries (`scripts/review-audio-alignments.py`: hashes, bounds,
  score >= 0.30, speech rate within 6 MADs of the set) record as reviewed. A
  stale summary or alignment refuses the chapter's clips.
- A verse is _questionable_ if its score is < 0.30 or the review flagged it.
  Only the two cut points need trusted timing: both verses beside each cut
  must be unquestionable, or, when exactly one is, the cut must sit in
  silence (>= 0.3 s at -35 dB, detected in the original) that contains both
  aligned verse edges. A clip containing a questionable verse is cut the same
  way but published with chapter-only tracking (`alignment: "chapter"`, no
  cues). Anything else **blocks** the whole reading, listed with its reason
  in `artifacts/audio-work/reading-audio-report.json` (with every
  chapter-only clip and silence-confirmed cut). Nothing is invented, and a
  blocked reading shows no Listen button.

### Evidence boundary

The machine review is not listening review. The 929 Old Testament alignments
(`data/audio/alignments/ot/`, MMS_FA, committed timings only) pass structurally;
their review flags are in `data/audio/review/`. Nobody has yet listened to every
cut, and the build does not claim they are perfect: it only refuses what the
evidence cannot support. Whole-chapter OT playback stays chapter-only; its
alignments only serve clip cuts.

With the chronology of 23 October 2026 all 553 readings build (OT 412, NT 141)
from 1,095 deduplicated clips. Some clips use chapter-only tracking because a
verse inside them is questionable (the parent audit counted 26 occurrences; the
exact figure belongs to the generated report, not to this guide). That is the
passage-level fallback: the passage still plays, tracked at passage level with no
verse highlighting or skip, instead of cues the evidence cannot back. The
Deut 25:4|5 cut (25:4 scores 0.298) is confirmed by silence at 44.457-45.72 s.

## Spoken passage references

`data/audio/reference-texts.json` holds a draft spoken reference for each of the
537 plan passages (`scripts/prepare-reference-texts.py`), for example
«إنجيل لوقا، الإصحاح الأول، من الآية الأولى إلى الرابعة». All are
`reviewed: false`. Generating the voice is separate work; nothing is spoken in the
browser, and the current release publishes no spoken labels or announced days.

`build-audio.py --announcements <catalog.json>` assembles days with a reference
before every passage. The catalog sits beside its WAV clips:

```json
{
  "version": 1,
  "voice": "who or what produced the clips",
  "settings": { "...": "generation settings" },
  "clips": {
    "LUK-1-1-4": {
      "file": "LUK-1-1-4.wav",
      "text": "exact wording from reference-texts.json",
      "textHash": "sha256 of text",
      "audioHash": "sha256 of the WAV file",
      "settingsHash": "sha256 of the compact settings JSON",
      "reviewed": true
    }
  }
}
```

Assembly refuses a clip whose wording, text hash, settings hash or audio hash
differs, and unreviewed wording or clips unless `--draft`. Draft output must stay
outside `public/` and `data/`. Scripture PCM comes from the original chapter
recordings and is never scaled; only clips are matched to the day's active
Scripture loudness, within a peak limit. Each passage is laid out in whole
samples at 24 kHz: separation (0.2–0.35 s, default 0.25), reference, separation,
Scripture. Cues are exact sample offsets and each `reference` interval runs from
the previous Scripture to the passage's first verse, so the player shows the
reference and highlights no verse in between. Verse skip goes past it. The day is
encoded once, and its name fingerprints the spans, clip hashes, gains,
separation, cues and encoding. Version-2 manifests and a sample-level
`report.json` go to `artifacts/audio-work/announced/` by default; the published
`data/audio/manifests/` and `catalog.json` are never written in this mode.
Without `--announcements` the existing daily build is unchanged.

Publishing announced days needs, in order: reviewed wording, an approved voice
with distribution terms, listening review of the pilot days 1, 32 and 150 (names,
pacing, music boundaries, volume, seeking, speed, background playback), then
deploying the media before the manifests that reference it.

## Delivery and performance

Files use mono AAC at 48 kbps in an M4A container, with metadata at the beginning
(`+faststart`). The browser can begin streaming before downloading the whole day.
The target bandwidth is about **0.36 MB/minute**, or **2.9 MB for an eight-minute
reading**. The prepared 150-day set is **481.6 MB** (median **3.18 MB**, largest
**4.58 MB**), covering 21.71 hours and 7,966 verse cues including repeated
passages. File sizes vary with encoding overhead and recording length.

The player code, timing JSON, and audio load only after the reader taps “استمع”.
No audio is prefetched at startup or downloaded for adjacent days or readings.
One native audio element plays everything, including playlists, which move
between files on its `ended` event. The browser reuses an immutable file from
its cache, and readings that share a chapter or clip point at the same URL. A native audio
element handles buffering and HTTP range requests; audio is never fetched into a
JavaScript Blob or processed with Web Audio. Scripture is not rerendered on each
audio event; only the active verse marker and small player update.

The delivery rules live in `src/audio/contract.ts`: the media path patterns
`/audio/days/NNN-<hash>.m4a` and `/audio/chapters/assets/<USFM>-<n>-<hash>.m4a`,
the 8 MiB size cap, the content type, the cache
value and the Pages origin. The app validates every manifest `src` against that
pattern, and the Pages bundle script imports it. `vercel.json` and the Cloudflare
worker (deployed verbatim, so it cannot import) repeat the values; tests keep
them equal to the contract.

Each media filename contains a content fingerprint. Serve media with:

```http
Content-Type: audio/mp4
Cache-Control: public, max-age=31536000, immutable
```

The host must support byte ranges and return correct `Content-Length` and
`Content-Range` headers. Never reuse an immutable media URL for changed audio.
Day, chapter and chronological playlist JSON remain on Vercel with revalidation,
so timing fixes take effect. `vercel.json` sets `Vercel-CDN-Cache-Control: no-store`
on `/audio/days/*`, `/audio/chapters/assets/*` and `/audio/clips/*`, so Vercel
never caches proxied media itself; the browser and Cloudflare do.

## Current deployment: Vercel + Cloudflare Pages

The 150 recordings live in the `bible-reading-audio` Pages project. Vercel proxies
only `/audio/days/:file` to that host; timing manifests remain in the app build.
The Cloudflare app worker (`hosting/cloudflare-app/`) proxies the same media
paths for `chronosbible.com`. Set `VITE_AUDIO_BASE_URL=/` to enable the
same-origin media route in a Git-only build. The `dev` preview is configured
this way. Production/main must be configured
separately when promoting the audio release. `vite.config.ts` validates the value
and inlines it as `__AUDIO_BASE_URL__`, so the app never reads `import.meta.env`.
Direct `pages.dev` URLs are not promoted automatically: they time out on some
local DNS answers, so the same-origin route stays the default.

### R2 (current for Cloudflare)

Cloudflare builds load every verified recording from the R2 bucket
`chronosbible-audio`, served read-only at `https://audio.chronosbible.com` with
the same paths (`/audio/days/…`, `/audio/chapters/assets/…`, `/audio/clips/…`).
Objects carry `Content-Type: audio/mp4` and
`Cache-Control: public, max-age=31536000, immutable`; R2 answers byte ranges
natively. A new release is uploaded with `npx wrangler@4 r2 bulk put
chronosbible-audio --filename <key/file JSON> --content-type audio/mp4
--cache-control "public, max-age=31536000, immutable" --remote`, then verified
with `scripts/verify-audio-host.py https://audio.chronosbible.com --inventory
<prepared inventory>`. Objects are never overwritten or deleted: names are
immutable hashes, and a rollback keeps the old files. Vercel still uses the
Pages host until its `VITE_AUDIO_BASE_URL` is changed.

### Prepared is not published

Two inventories are kept apart:

- **Prepared** — `artifacts/pages-audio-inventory.json`, written by
  `npm run audio:host:prepare`: every file in the local bundle with its size and
  SHA-256. Ignored by Git; it proves nothing about the host.
- **Verified** — `data/audio/publication.json`, written only by
  `scripts/verify-audio-host.py --publish` after **every** file of a prepared
  release passed byte-exact range checks on the deployed host. It lists each
  media path with size, SHA-256 and the release that first verified it, plus
  each release's host, date and method. Committed, because builds read it.

A configured host advertises every prepared day (these were deployed and
verified before the inventory existed) but no hosted chapter. Chapter
recordings need `VITE_AUDIO_CHAPTERS_ENABLED=true` (default `false`; any value
other than `true`, `false` or empty fails the build) **and** every catalogued
chapter in the verified inventory; otherwise the build fails and names a
missing chapter. A chronological playlist is advertised only when every file it
references, full chapters and clips alike, is verified. Chapters whose media is
present in the build's own `public/` folder are advertised regardless, so local
development with prepared media still works. Synthetic fixture hosts on the
reserved `.test` domain (CI) bypass the inventory; real hosts never do. The
build also deletes from `dist/` every manifest it does not advertise, so an
unpublished manifest is never uploaded.

### Publishing a release

The bundle holds what the catalogs need **plus every file already in the
verified inventory**, so an older app build (rollback) keeps its media after a
new Pages deployment replaces the previous one. A missing file stops
preparation; nothing is dropped silently. `--retain <inventory.json>` keeps
extra files (for example an older prepared inventory). Media roots are a
`:`-separated `AUDIO_MEDIA_ROOT` or repeated `--media`; recordings are
hard-linked into the bundle when on the same disk (no 2.7 GB copy; `--copy`
forces copies). Limits are checked: at most 8 MiB per file and 20,000 files per
deployment. The earlier release was 1,339 files (150 days + 1,189 chapters); the
2,435-file release supersedes it.

1. `AUDIO_MEDIA_ROOT=<daily root>:<chapter root> npm run audio:host:prepare`
2. Deploy `artifacts/pages-audio` with
   `wrangler pages deploy artifacts/pages-audio --project-name bible-reading-audio --branch main --commit-dirty=true`.
3. `python3 scripts/verify-audio-host.py https://<app origin>` checks every file
   in the prepared inventory through the app's media route: three ranges per
   file (start, middle, suffix) against the local bytes, exact `Content-Range`
   and `Content-Length`, `audio/mp4`, immutable caching, and one `416` past the
   end. `--full` also downloads each file and compares its SHA-256. Network
   failures and `5xx` are retried; any failure publishes nothing.
4. Re-run with `--publish` to merge the release into `data/audio/publication.json`.
   A path whose bytes differ from an earlier verified entry is refused.
5. Commit the inventory, then set `VITE_AUDIO_CHAPTERS_ENABLED=true` for the
   Vercel environment and rebuild.

#### Staged release

1. Upload and verify the corrected canonical chapters, publish them.
2. Upload and verify the clips and chronological assets, publish them.
3. Only then rebuild the app with the flags on. Each stage can be rolled back
   alone because superseded files stay in the bundle (`supersedes`), and because
   a reading is advertised only when everything it references is verified, an
   interrupted upload leaves the app consistent: readings simply stay without
   Listen.

Here `--branch main` selects the **audio host's** production deployment; it does
not push or modify the application's Git branch. The bundle includes the range
handler and `_routes.json`, so only media paths invoke it. Unchanged uploads are
deduplicated. Do not deploy the raw media folder without the handler.
`npm run audio:host:deploy` still prepares and deploys in one step.

This route avoids a connection timeout observed with the local DNS answers for
the Pages domain. Downloads through it count toward Vercel's transfer allowance.
It uses an external rewrite, without a Vercel server function.
Browser caching stays immutable, while `Vercel-CDN-Cache-Control: no-store`
prevents the proxy from caching a partial response and reusing it for a different
range. Cloudflare still caches the underlying complete static asset.

### The range handler

Pages returns complete `200` responses to range requests. That caused seeking to
jump back to the beginning on a cold Vercel cache. The narrow Pages handler in
`hosting/cloudflare-audio/worker.js` returns correct `206` responses, including
Safari's two-byte probe, open-ended ranges and suffix ranges; invalid offsets
return `416`, malformed or multipart ranges the whole file. Only paths matching
the media pattern are handled; anything else passes through untouched.

- **Warm ranges** come from the colo's Cache API:
  `caches.default.match(new Request(url, { headers: { Range } }))` answers a
  `206`/`416` from a cached complete file without the handler reading it.
- **A cold miss** fetches the Pages asset once without `Range` or conditional
  headers, refuses to buffer more than 8 MiB (a larger file streams through
  whole), checks the body against `Content-Length`, slices the range, and stores
  the complete `200` (with `Content-Length`, immutable caching, ETag) in the
  background. A `206`, a response carrying `Content-Range`, an error or a
  truncated body is never stored. The cache key is the path without its query
  string, so cache-busting parameters cannot multiply entries.
- **Preconditions come first** (RFC 9110 order), checked against the file's own
  ETag and `Last-Modified`, on cache hits, cold fills and whole-file/`HEAD`
  answers alike: a failed `If-Match` or `If-Unmodified-Since` returns `412`; a
  matching `If-None-Match` (weak comparison, `*`) or an unchanged
  `If-Modified-Since` returns `304` with validators and no body. Pages is always
  asked for the plain file, so its own `304` can never be sliced or cached.
- `If-Range` keeps the range only for the same strong ETag or exact
  `Last-Modified`; anything else, including a weak ETag, gets the whole file.
- `HEAD` and whole-file answers keep Pages' `Content-Length` and add
  `Accept-Ranges: bytes`. Every media answer carries the immutable
  `Cache-Control` and `Vercel-CDN-Cache-Control: no-store`; `X-Audio-Cache:
HIT|MISS` on ranges shows which path answered.

Whether the Cache API persists entries on the `pages.dev` hostname must be
confirmed after deployment (repeat a range and look for `X-Audio-Cache: HIT`);
if it does not, every range behaves as a cold miss, which is still correct. Daily
files are under 5 MB; the largest chapter, Psalm 119, is 7,664,871 bytes
(723,737 bytes of headroom).

Pages Functions share the Workers Free daily allowance of 100,000 requests; every
media range request counts, cached or not. Verification costs about three
requests per file (about 4,000 for the current release). This setup is not
unlimited hosting. Check the account's usage as listening grows. See
[Pages serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/),
[Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/),
[Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
and [Vercel external rewrites](https://vercel.com/docs/routing/rewrites).

## Alternative: Vercel + Cloudflare R2

1. Create an R2 bucket using **Standard** storage.
2. Upload the contents of `public/audio/days/` under the key prefix `audio/days/`.
3. Set the media metadata above when uploading.
4. Attach a public custom domain such as `audio.example.org` to the bucket and
   add a Cache Rule for that hostname and paths starting with `/audio/days/`:
   make them eligible for caching and respect the object Cache-Control header.
   The `r2.dev` development URL is rate-limited and does not support this cache.
   See [R2 cache setup](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/).
5. In Vercel, set the **public** variable
   `VITE_AUDIO_BASE_URL=https://audio.example.org` and rebuild.
6. Verify a real media URL responds to `Range: bytes=0-1023` with a `206` response,
   and test seeking on Safari and Chrome. Verify cache headers on repeat requests.

No R2 access key belongs in a `VITE_` variable or in the frontend. Native playback
does not need a JavaScript-readable cross-origin response. If adding waveform or
Web Audio features later, configure CORS for the exact website origins first.

As of 10 October 2026, R2 Standard includes 10 GB-month of storage, 1 million
Class A operations, and 10 million Class B operations monthly, with no egress
charge. This is a usage allowance, not an unlimited free service. A custom domain
has its own registration cost. See [current pricing](https://developers.cloudflare.com/r2/pricing/)
and [public bucket configuration](https://developers.cloudflare.com/r2/buckets/public-buckets/).

## Vercel-only alternative

Serve `public/audio/days/` from the deployment and leave `VITE_AUDIO_BASE_URL`
unset. `vercel.json` sets immutable media caching. The media must be present at
build/deploy time; it is intentionally absent from a fresh Git checkout.

Vercel serves static files from its CDN, but the downloads count toward transfer
allowances. Hobby currently includes 100 GB of Fast Data Transfer. At 3 MB per
daily play, 1,000 readers listening on 30 days would use roughly 90 GB before
other site traffic. Browser cache hits can reduce transfers, but do not assume
every repeat play will be cached. See [Vercel CDN usage](https://vercel.com/docs/manage-cdn-usage).

A Git-only deployment without media or a configured CDN hides audio entry points
and remains a complete text reader. Configuring a CDN enables prepared days;
verify that all referenced files are uploaded before setting the variable.

## Playback behavior and verification

The bottom player supports play/pause, previous/next verse, and a direct speed
button cycling through 0.75×, 1×, 1.25×, and 1.5×. Text tracking stays on during
playback, including after manual scrolling; it follows again on the next verse.
The Listen button changes to Close player while active. Recording credits live
in About. Opening any dialog pauses audio;
closing a dialog does not resume it automatically. Changing day, reader, or main
view stops playback. Listening never completes a day or advances to another day.

In Bible mode, «استماع متواصل للإصحاحات» in reader settings continues to the next
chapter when one ends naturally, in canonical order, and stops after Revelation 22.
Only the natural end continues: choosing a chapter (even the same one), changing
mode, Back/Forward, or the arrows stop playback at once. The same audio element
carries on while the next chapter's text and manifest load, and keyboard focus
stays in the player. Replaying or seeking an ended chapter re-arms continuation.
Old Testament chapters currently play without verse highlighting or verse skip.

The player remembers the position in each recording, keyed by its immutable
media path, so a rebuilt recording starts from the beginning. Positions are
saved every 5 seconds of playback and on pause, end, hiding the page and closing
the player (`bible-reader-audio-position-v1`, at most 20 recordings), separately
from plan progress. A continuous handoff starts the next chapter at its beginning.

Media Session supplies lock-screen controls where supported. One continuous file
per day avoids relying on JavaScript chapter switching while a phone is locked.
Background playback still depends on the browser/OS and needs physical-device
verification. Automatic playback after the manifest loads can require a second
tap on Safari; the play button remains available.

Run `npm test` and `npx playwright test tests/browser/audio.spec.ts` after building
the pilot media. Browser tests exercise real playback in Chromium and WebKit,
lazy requests, cue navigation, retries, stale transcripts, dialog pausing,
keyboard focus, widths 320–430, and narrow reflow. They cannot establish that
every machine-generated timestamp matches the narration or that lock-screen
behavior works on every phone.

CI uses `AUDIO_TEST_FIXTURES=1` and a build-time
`VITE_AUDIO_BASE_URL=https://audio.example.test`; `npm run test:e2e` also sets
`VITE_AUDIO_CHAPTERS_ENABLED=true` so the fixture build advertises chapters. Browser routes substitute
short synthetic WAV audio and accelerated cues; no copyrighted recordings or
external audio service are needed. These are test settings, not production
configuration. Local tests without this flag use the actual prepared media.

## Local verification — 11 October 2026

- The unit/data tests, the Chromium/WebKit browser checks, and additional
  real-recording browser checks passed. Accessibility checks use axe.
- All 150 manifests match the current Scripture, passage order, and verse counts.
  All media files are mono AAC at 24 kHz with fast-start metadata. The local
  static server returns `206` for byte-range requests.
- Three Lighthouse runs per build used identical default mobile throttling,
  comparing the pre-audio `edc193d` build with this implementation:

| Median metric             |   Before | With audio support |
| ------------------------- | -------: | -----------------: |
| Performance               |       88 |                 88 |
| Accessibility             |      100 |                100 |
| LCP                       | 3,604 ms |           3,602 ms |
| CLS                       |   0.0865 |             0.0862 |
| Initial transferred bytes |  494,146 |            494,926 |

All three new-build audits made zero audio/player-chunk requests before a tap.
These are local build comparisons, not production CDN measurements. R2 delivery
and physical-device background playback still need verification after hosting
is configured. Machine timing review remains separate from functional tests.

## Local verification — 16 October 2026 (full Bible)

- `verify-canonical-audio.py` passed for all 1,189 chapters, including every
  original recording's SHA-256 and the exact source coverage: 260 verse-timed NT,
  929 chapter-timed OT, AAC mono 24 kHz, fast start, durations within 0.05 s.
- The range handler returned byte-exact `206` responses from the prepared bundle
  for Psalm 119, 1 Kings 8 and Ezekiel 16 (two-byte probe, middle, suffix,
  open-ended and over-long ranges) and `416` past the end.
- Pilot days 1, 32 and 150 were assembled from the original NT recordings with
  synthetic 440 Hz tones standing in for references (no voice). Encoded durations
  equalled the sample layout; the tone filled each reference interval and was
  absent from Scripture; Scripture matched the original recordings at zero
  sample lag. The client accepted all three manifests. Rebuilding days 1 and 150
  without references reproduced their published manifests and media names.
- Browser checks use synthetic media only (`tests/browser/bible-audio.spec.ts`).
  They do not show that a phone keeps playing across chapters while locked; that
  needs physical iOS and Android testing.
