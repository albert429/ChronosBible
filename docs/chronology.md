# Self-paced chronological readings

The Old and New Testament chronologies are built from the user-supplied
`Chronological.pdf` (22 pages, SHA-256
`5d99356d6a54b2724c4cd9db8ca113a4a6741a0c09035cbf44930a8e8c234ea4`). Its 365
numbered groups (Old Testament 1–266, New Testament 267–365) are the source's
own groupings. They are not app days. The app regroups them into readings of
about ten minutes. The PDF and page renders are not committed.

## Pipeline

1. `scripts/import-chronology.py <pdf>` (needs `pypdf`; run with `-I`) checks
   the hash and parses the extracted table text into
   `data/chronology/source.json`. Every occurrence keeps a stable id
   (`g060-2` = group 60, second entry), its page and group, the reference in
   reading order (`original`) and the raw extracted text. Right-to-left
   extraction emits `a:c-b` for chapter c, verses a–b; for example, `1:10-5`
   is Genesis 10:1–5. Nothing is corrected, deduplicated or filled at this
   stage.
2. `data/chronology/stages.json` holds the stage and substage starts. Each
   start names a source occurrence (plus an optional verse) and the verse it
   must begin with, together with the reason for the placement.
3. `data/chronology/review.json` records the reviewed audit: every
   repetition, every omission and every applied correction. If the source
   audit differs from this file in any way, the build stops.
4. `scripts/build-chronology.js` (run by `scripts/build-data.js`) writes the
   ignored output `public/chronology/OT.json` and `NT.json` (catalogs:
   summaries only) and one definition per reading,
   `public/chronology/<T>/<id>.json` (references only). Scripture text is
   never copied: at run time `src/chronology/client.ts` slices the existing
   canonical chapters, `/bible/<USFM>/<n>.json`, which load through the shared
   chapter cache. Headings, superscriptions, acrostics, paragraphs and poetry
   blocks inside each range are kept with their canonical verse numbers and
   codepoint offsets.

All 22 pages were compared visually with the parsed groups.

## Stages

The stages follow the source order. Nothing is moved: Job, the Psalms, the
wisdom books and the prophets stay where the source puts them.

| Old Testament stage             | Starts at   | Note                                                  |
| ------------------------------- | ----------- | ----------------------------------------------------- |
| البدايات: الخلق والطوفان        | Gen 1:1     |                                                       |
| الآباء: من إبراهيم إلى يوسف     | Gen 11:27   | Includes Job, which the source places after Gen 50    |
| الخروج من مصر والعهد            | Exod 1:1    | Sinai, Leviticus and Num 1–9 (both copies of Num 7–9) |
| البرية والاستعداد لأرض الموعد   | Num 10:1    | Leaving Sinai, through Deut 34 and Ps 90              |
| أرض الموعد وعصر القضاة          | Josh 1:1    | Through 1 Sam 7                                       |
| المملكة المتحدة                 | 1 Sam 8:1   | Israel asks for a king; ends with Ecclesiastes        |
| المملكة المنقسمة وخدمة الأنبياء | 1 Kgs 12:1  | Ends at the siege of Jerusalem                        |
| السبي والرجاء                   | 2 Kgs 25:3  | The fall of Jerusalem                                 |
| العودة وتجديد العهد             | 2 Chr 36:22 | Cyrus's decree; the source ends with Joel             |

| New Testament stage / substage      | Starts at  | Note                                              |
| ----------------------------------- | ---------- | ------------------------------------------------- |
| حياة يسوع وخدمته — الميلاد والبداية | Mark 1:1   | Through John 2–4, the "beginning of signs"        |
| — الخدمة                            | Mark 1:14  | Galilean preaching after John's arrest            |
| — الصلب والقيامة                    | Mark 14:1  | Plot and Passover through the ascension           |
| بداية الكنيسة وانتشار الإنجيل       | Acts 1:1   |                                                   |
| رحلات بولس — الأولى                 | Acts 13:1  | Galatians and the Jerusalem council               |
| — الثانية                           | Acts 15:36 | Heading «بولس وبرنابا يفترقان»; 1–2 Thessalonians |
| — الثالثة                           | Acts 18:23 | 1 Corinthians, Romans, 2 Corinthians              |
| بولس إلى روما ورسائل السجن          | Acts 21:1  | Ephesians, Colossians, Philemon, Philippians      |
| تثبيت الكنائس ورسائل الرسل          | James 1:1  | James follows Philippians in the source           |
| سفر الرؤيا                          | Rev 1:1    |                                                   |

Two substage starts fall inside a source passage, at Acts 15:36 and Acts
18:23. These passages are split there, and the split is recorded as a `split`
exception.

## Grouping into readings

- Pace: 80 words per minute for both testaments. The only measured timing in
  the repository is the New Testament audio drama, at 82.3 words per minute
  over 260 chapters. Rounding down keeps the estimates slightly long.
  `estimatedMinutes` = words ÷ 80, rounded.
- A reading may begin only at a canonical boundary: a chapter start, the
  verse after a chapter's last verse (even when the source continues
  mid-chapter elsewhere), or a section heading or acrostic at the start of a
  verse. The source's own groups are daily divisions, not breaks: a passage
  that continues across two groups (e.g. Genesis 28:1–5 and 28:6–22) is read
  together. Verses are never split, and no reading crosses a stage or
  substage; those ends are always breaks.
- Each reading ends at the boundary nearest 800 words. On a tie, the earlier
  boundary wins. Nothing overrides this rule, so a stage may end with a short
  reading.
- Titles list exactly the verses read, per book, as contiguous runs
  («التكوين ١١: ٢٧–٣١، ١٢–١٤»). Gaps are never shown as one span. A title
  over 200 characters ends with «…».
- Reading ids are the first verse as a slug (`gen-1-1`, `1sa-8-1`). When a
  repeated passage starts a second reading at the same verse, the id gets a
  suffix (`num-7-1-2`). Ids are deterministic, and a test pins them; changing
  them affects saved places and completion.

Result: 412 Old Testament readings and 141 New Testament readings. Over 95%
take 7–13 minutes; none is longer than 14. Readings under 5 minutes occur only
at a stage or substage end, for example Joel 3:18–21 (1 minute), which ends
the Old Testament.

## Audit (`npm test`: `tests/chronology*.test.ts`)

|                            | Old Testament | New Testament                          |
| -------------------------- | ------------- | -------------------------------------- |
| Source occurrences         | 1224          | 534                                    |
| Verse occurrences          | 23309         | 7965 (7966 after the 6:22 exception)   |
| Canonical verses / covered | 23145 / 23145 | 7959 / 7958 (7959 after the exception) |
| Repeated verse occurrences | 164 (16 sets) | 7 (4 sets)                             |
| Invalid references         | 0             | 0                                      |

- **New Testament and the church plan.** Ignoring passage and day
  boundaries, the PDF and `data/plan.json` list exactly the same verses in
  the same order, with one exception. The PDF ends 1 Timothy 6 at verse 21,
  while the Van Dyck text and the church plan include the closing blessing as
  6:22. The self-paced New Testament includes 6:22 as a documented
  `corrected` exception on `g349-1`. As a result, its verse sequence is
  identical to the church plan. The church plan itself is unchanged.
- **Repetitions are kept as listed in the source**, each with its own
  occurrence id and provenance. They include the known repeat of Numbers 7–9
  (with Exodus 40, and again in group 60) and shared half-verses. The parent
  review kept all of them, including five probable source errors. For these,
  a suggestion is recorded in `review.json` for a future source revision:
  - 2 Sam 4 (g111-2) repeats 4:4, which the source already read with Saul's
    death; suggested 4:1–3, 4:5–12.
  - 1 Kgs 14:1–24 (g160-2) repeats 14:19–20, which the source places again
    after 15:9–15; suggested 14:1–18, 14:21–24.
  - 2 Chr 12:13–16 (g160-7) repeats 12:13–14; suggested 12:15–16.
  - 2 Kgs 8 (g167-4) repeats 8:16–22 (group 165) and 8:23–29 (group 168);
    suggested 8:1–15.
- There are no other omissions or corrections.

To regenerate after a source change, run the importer and then the build.
Re-review every audit difference in `review.json`; the build refuses
unreviewed changes.
