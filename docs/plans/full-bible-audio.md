# Full Arabic Bible mode and spoken passage announcements

> **Archived (25 October 2026).** This plan is kept as a historical record. The
> Vercel rewrite and the `bible-reading-audio` Pages host it describes were
> retired: every recording is now served from R2 at
> `https://audio.chronosbible.com`. See [docs/audio.md](../audio.md) for the
> current deployment.

Feasibility study and implementation plan, 11 October 2026. Planning only.

## Decisions and findings

- Add a second reading mode: **الكتاب المقدس**, in the conventional 66-book order,
  Genesis through Revelation. Keep **خطة القراءة** for the 150-day chronological plan.
- The user confirmed a spoken reference before **every passage** in the plan,
  for example: **إنجيل لوقا، الإصحاح الأول، من الآية الأولى إلى الرابعة**.
  This means a passage reference, not a heading before every paragraph or verse.
- Both features are technically feasible. Full Old Testament audio remains a
  source acquisition and validation dependency; the local download contains NT only.
- Build announcements into the media offline. Keep the reader and text delivery static.

The following was verified locally against the repo and the eBible USFM archive:

| Item                          | Finding                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| Full Van Dyck text            | 66 books, 1,189 chapters: 929 OT and 260 NT                                         |
| Text payload estimate         | 2.20 MB summed gzip chapter verse maps; largest 5.65 KB, before structural metadata |
| Existing audio                | 260 original NT chapter MP3s and 260 alignment files                                |
| Reusable alignment            | All 260 transcript hashes match the full-Bible NT source                            |
| Chronological plan            | 150 days, 537 passages, 537 distinct full passage references                        |
| Most announcements in one day | Day 32: 12 passages                                                                 |
| Existing daily audio          | 481.6 MB at 48 kbps mono AAC                                                        |

Text source: [eBible Van Dyck](https://ebible.org/bible/details.php?id=arb-vd),
which identifies the text as public domain. Inspected archive SHA-256:
`21097759376591c9d1c4b07440e36cd870e44ec5f44e4a84b215b35f17c7b150`.
The counts and payload measurements are an inventory, not a visual validation
of Old Testament headings and poetry. The current parser drops those structures.

## 1. Feasibility of spoken announcements

### Recommended approach

Create short, reviewed Arabic reference recordings once, then prepend them to
each passage during offline assembly. Keep a single continuous file per day.
Use a human recording or a stock Arabic TTS voice with terms permitting distribution
of its output. A stock voice should be audibly identifiable as an announcement;
matching or cloning the Scripture narrator is unnecessary.

[Azure Speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)
is one candidate with Arabic voices, including Egyptian Arabic. Provider choice
and pronunciation quality require a small voice audition; no provider account,
paid generation, or new recording has been created in this study.

| Method                                                 | Assessment                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Reuse original chapter openings                        | Worth auditing for full-chapter mode. Cannot assume they include book names or the requested verse ranges.                 |
| Record full references with a human                    | Most control over names and Arabic pronunciation; more recording/editing work.                                             |
| Generate full references with stock Arabic TTS offline | Recommended automation candidate; consistent voice and one-time generation, followed by pronunciation review.              |
| Speak references in the browser during playback        | Avoid for the main experience: device voices vary and it adds coordination with the audio element and background playback. |

Browser voice availability is device-dependent according to
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices).
The preference for offline assembly is an engineering recommendation, not a
claim that browser speech never works.

### Wording and timing

- Produce a complete reference clip, rather than stitching individual number words.
- Write numbers as spoken Arabic words, with reviewed ordinals and diacritics.
- Use correct book titles; use **المزمور** for Psalms. Handle single-verse passages
  and one-chapter books explicitly. There are six single-verse passages in the plan.
- Announce every passage, including the one adjacent same-chapter pair in the plan.
- Start with roughly 200–350 ms of separation around each announcement, and match
  perceived loudness. Preserve Scripture wording and the dramatic recording's dynamics.
- For canonical chapter mode, announce book/chapter once at the start. Audit the
  original opening first to avoid saying the title twice.

Assuming 5–8 seconds per complete passage reference, all 537 announcements add
about **45–72 minutes / 16–26 MB** at 48 kbps, before small encoding overheads.
Day 32 would become approximately 60–96 seconds longer. These are planning estimates;
the voice audition must establish actual durations and acceptable pacing.

### Required changes

- Extend `scripts/build-audio.py` to insert reviewed announcement PCM and encode
  once from source recordings. Avoid re-encoding the existing lossy daily M4As.
- Shift every verse cue by the exact accumulated announcement sample count.
  No realignment is needed just because an introduction was inserted.
- Add explicit announcement intervals to a versioned manifest. The current
  `cueAt()` returns a Scripture verse during any gap, so it must understand
  announcements and clear the verse highlight while a reference is being spoken.
- Show the passage reference in the compact player during an announcement.
  Do not scroll through verses until Scripture resumes.
- Verse navigation should seek directly to verse audio. Natural playback should
  include each announcement exactly once. Test pauses, resume, and seeking inside an intro.
- Include announcement content, voice/settings, audio hashes, and timing in build
  fingerprints. New audio gets new immutable filenames.
- Deploy backward-compatible manifest readers before publishing newer manifests.
  Upload media before referencing it and retain older assets for rollback/open clients.

### Pilot gate

Before rebuilding all days, audition several references covering a Gospel,
an epistle, a long chapter number, and a single verse. Assemble days **1, 32, and 150**.
Check pronunciation, pacing, music boundaries, volume, verse synchronization,
speed changes, seeking, and background playback on physical iOS/Android devices.
Revisit the existing eight low-confidence verse alignments in `data/audio/SOURCES.md`.
Automated synchronization checks do not replace listening to the transitions.

## 2. Whole-Bible mode

### Reading experience

- Put a compact two-option mode selector in the main menu. Remember the last mode
  and the last location within each mode.
- Reuse the slim sticky toolbar. In Bible mode its center shows **التكوين ١ ▾**;
  previous/next moves through chapters in normal book order.
- Open a bottom sheet with **العهد القديم / العهد الجديد**, an accessible book list,
  and chapter selection. Keep the reading itself directly below the toolbar.
- Retain the Amiri font, size preferences, dark mode, margins, and audio controls.
- Preserve paragraph, poetry, Psalm superscription, and genuine section-heading
  structure from USFM; headings must remain distinct from numbered verse text.
- Remember chapter/verse and playback position independently of the chronological
  day-completion record. Do not mark plan days complete while browsing the Bible.
- Support a static-host-friendly chapter link such as
  `/?mode=bible&book=GEN&chapter=1&verse=1` and browser Back/Forward navigation.
- Canonical audio plays one chapter at a time. Offer a compact **continuous listening**
  preference in reader settings; if enabled, advance in canonical order and stop at
  Revelation 22. Test cross-chapter continuation while the phone is locked rather
  than promising background behavior from desktop browser automation alone.

### Data and player architecture

- Build a lightweight book/chapter catalog and one static text JSON per chapter.
  Load the current chapter only; reuse caching and conservative adjacent text prefetch.
- Introduce a common reading identity, with distinct `plan:<day>` and
  `bible:<book>:<chapter>` keys. Generalize `Reader`, audio manifests, and player
  loading without making chapter IDs pretend to be plan days.
- Keep current plan URLs/data compatible. Add canonical manifests/media under
  `/audio/chapters/`; update URL validation, Vite availability, Vercel rewrites,
  the Pages bundle builder, and function routing for this namespace together.
- Encode full NT chapters directly from the 260 originals and reuse verified
  source timings. Trimming the introductory audio must shift cues accordingly.
- Keep separate daily audio to preserve continuous chronological playback.
  Sharing a single source/alignment pipeline avoids duplicate maintenance, even
  though daily and canonical listening need different output files.
- Generalize study lookup to canonical verse IDs. Existing Greek data applies to
  the NT; do not present it as OT Hebrew coverage. Load available study data only
  when requested and handle absent data explicitly.
- Keep new navigation/resume preferences separate from existing completion data.
  If included in backups, add an optional versioned extension and support older imports.

### Old Testament source dependency

[MegaVoice's Van Dyck Old Testament catalog](https://megavoice.com/media-cloud/m0b6792-old-testament-arb-arabic-standard-audio-bible/)
lists 39 books, approximately **76 hours 3 minutes**, and Faith Comes By Hearing
as publisher. This confirms a candidate recording exists. It does not establish
that its full files are available for this app, match the NT narrator, or can be
redistributed under the text's public-domain designation.

Before calling full-Bible audio complete:

1. Obtain the 929 OT chapter recordings with their source/attribution and applicable
   reuse terms. Confirm the actual edition; similar Van Dyck labels alone are insufficient.
2. Check book/chapter coverage, chapter boundaries, Psalm numbering/titles,
   and spoken wording against the selected eBible text.
3. Generalize the alignment script's NT-only book selection and filename assumptions.
   Align OT chapters offline and retain source/transcript hashes and review scores.
4. Review samples across narrative, law, poetry, prophecy, and long chapters;
   manually inspect flagged verses and boundaries.

The full text and NT audio can be developed while this dependency is resolved.
An interim preview should clearly identify OT chapters whose recordings are unavailable.
That preview is not completion of the requested whole-Bible-with-audio feature.

## 3. Hosting and performance budget

The candidate OT duration plus our 22.12-hour NT source gives approximately
98.17 hours. At 48 kbps this is **2.12 GB** of canonical audio before overhead.
Together with the chronological files and introductions, budget roughly
**2.6–2.8 GB** of hosted audio. This is an estimate until the OT files are acquired.

- Keep encoding and alignment offline; no startup audio downloads or full-Bible prefetch.
- Stream native audio with byte-range requests and immutable content-addressed filenames.
- Audit long chapters against the existing **8 MiB handler limit**. Psalm 119 is a
  specific test case. Adapt bounded streaming delivery or hosting if necessary;
  never truncate a chapter to fit the limit.
- Keep the Vercel proxy's protection against caching one partial response for a
  different range. Verify different ranges on the same URL, including cold requests.
- Larger library size does not by itself increase initial page load; listening
  time determines transfer. At 48 kbps, one hour is about **21.6 MB**.
- The current architecture can support a pilot. Measure function requests, memory,
  playback latency, and Vercel transfer before a full release. Do not assume storage
  capacity alone proves the free-tier delivery budget is sufficient.

## 4. Delivery sequence and acceptance

1. **Announcement feasibility pilot:** review voices and the three pilot days.
2. **Canonical data and minimal navigation:** all 66 books, 1,189 chapters, preserved
   Arabic structure, links/history, saved location, and existing plan regression checks.
3. **Canonical NT audio:** 260 chapters using the existing sources and alignments.
4. **Canonical OT audio:** acquire, validate, align, and prepare the remaining 929 chapters.
5. **Full announcements and release:** rebuild all daily audio, verify deployment
   ordering and cache compatibility, then test the complete experience on `dev`.

Acceptance includes exact source-text parity, book/chapter boundaries, no misleading
audio availability, separate mode state, old backup compatibility, announcement/verse
cue correctness, failed-download retry, rapid mode changes, keyboard/focus behavior,
320–430 px widths, 200% reflow, dark mode, maximum font size, and physical mobile
background playback. Compare initial requests/LCP/CLS with the current app; the new
mode must not fetch all Scripture or media on startup. Keep work on `dev` until a
production release is requested.
