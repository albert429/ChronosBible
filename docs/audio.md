# Static audio delivery

The reader plays a single audio file for each day. All source selection, verse
alignment, trimming, and encoding happen offline. The reader is a static frontend
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

## Delivery and performance

Files use mono AAC at 48 kbps in an M4A container, with metadata at the beginning
(`+faststart`). The browser can begin streaming before downloading the whole day.
The target bandwidth is about **0.36 MB/minute**, or **2.9 MB for an eight-minute
reading**. The prepared 150-day set is **481.6 MB** (median **3.18 MB**, largest
**4.58 MB**), covering 21.71 hours and 7,966 verse cues including repeated
passages. File sizes vary with encoding overhead and recording length.

The player code, timing JSON, and audio load only after the reader taps “استمع”.
No audio is prefetched at startup or downloaded for adjacent days. A native audio
element handles buffering and HTTP range requests; audio is never fetched into a
JavaScript Blob or processed with Web Audio. Scripture is not rerendered on each
audio event; only the active verse marker and small player update.

The delivery rules live in `src/audio/contract.ts`: the media path pattern
`/audio/days/NNN-<hash>.m4a`, the 8 MiB size cap, the content type, the cache
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
Day JSON remains on Vercel with revalidation, so timing fixes take effect. `vercel.json` sets `Vercel-CDN-Cache-Control: no-store` on `/audio/days/*`, so Vercel never caches proxied media itself; the browser and Cloudflare do.

## Current deployment: Vercel + Cloudflare Pages

The 150 recordings live in the `bible-reading-audio` Pages project. Vercel proxies
only `/audio/days/:file` to that host; timing manifests remain in the app build.
The Cloudflare app worker (`hosting/cloudflare-app/`) proxies the same media
paths for `chronosbible.com`. Set `VITE_AUDIO_BASE_URL=/` to enable the
same-origin media route in a Git-only build. The `dev` preview is configured
this way. Production/main must be configured
separately when promoting the audio release. `vite.config.ts` validates the value
and inlines it as `__AUDIO_BASE_URL__`, so the app never reads `import.meta.env`.

### R2 (current)

The recordings are also in the R2 bucket `chronosbible-audio`, served read-only
at `https://audio.chronosbible.com` with the same paths, `Content-Type:
audio/mp4` and `Cache-Control: public, max-age=31536000, immutable`; R2 answers
byte ranges natively. Cloudflare builds and Vercel (`VITE_AUDIO_BASE_URL`) load
audio from there. All 2,435 files of the full release passed byte-exact range
checks on that host on 25 October 2026.

This route avoids a connection timeout observed with the local DNS answers for
the Pages domain. Downloads through it count toward Vercel's transfer allowance.
It uses an external rewrite, without a Vercel server function.
Browser caching stays immutable, while `Vercel-CDN-Cache-Control: no-store`
prevents the proxy from caching a partial response and reusing it for a different
range. Cloudflare still caches the underlying complete static asset.

Pages currently returns complete `200` responses to range requests. That caused
seeking to jump back to the beginning on a cold Vercel cache. The narrow Pages
handler in `hosting/cloudflare-audio/worker.js` returns correct `206` responses,
including Safari's two-byte probe, open-ended ranges, and suffix ranges. Invalid
offsets return `416`. It reads a cached static asset internally; the app still
uses native streaming. The preparation script caps recordings at 8 MiB to bound
handler memory use (current files are under 5 MB).

To prepare and deploy updated media from the local recordings:

```sh
npm run audio:host:prepare   # builds artifacts/pages-audio
npm run audio:host:deploy    # prepares, then runs wrangler pages deploy
```

`audio:host:deploy` runs `npx wrangler@4 pages deploy artifacts/pages-audio
--project-name bible-reading-audio --branch main --commit-dirty=true`.

Here `--branch main` selects the **audio host's** production deployment; it does
not push or modify the application's Git branch. The bundle includes the range
handler and `_routes.json`, so only media paths invoke it. Unchanged uploads are
deduplicated. Do not deploy the raw media folder without the handler.

Pages Functions share the Workers Free daily request allowance; this setup is
not unlimited hosting. Check the account's usage as listening grows. See
[Pages serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/),
[Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/),
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
`VITE_AUDIO_BASE_URL=https://audio.example.test`. Browser routes substitute
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
