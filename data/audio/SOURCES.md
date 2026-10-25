# Recorded audio provenance

Source: user-supplied `Arabic_arb_VDV_NT_Drama`, 260 chapter MP3s,
639,284,777 bytes and approximately 22.12 hours. Embedded tags identify
Arabic Van Dyck — Audio Drama, © 1996 Bible Society of Egypt;
℗ 2008 Hosanna / Faith Comes By Hearing. No narrator identity is asserted.
Audio reuse rights are separate from the public-domain Scripture text.

Verse cues were generated offline with TorchAudio 2.8 MMS_FA and uroman 1.3.1.
They are machine alignments, not manually verified timings. Chapter audio hashes
and transcript hashes are checked during assembly. Daily manifests preserve
the plan's passage order and carry a fingerprint of the displayed text.
The committed timings are in `data/audio/alignments/`: one JSON file per chapter
(260), holding machine-made cue times, the source MP3 filename, and its hashes. They
contain no audio.
See [preparation and hosting](../../docs/audio.md).

## Old Testament recordings

Source: user-supplied `ARBVDVO2DA.zip` (929 chapter MP3s, CRC-checked when
extracted). Despite the archive name, the files are named `…ARZVDVO1DA.mp3` and
their embedded tags read **Bible - Arabic - Old Testament - Audio Non-Drama**,
`O1ARB/VDV`, **© 1999 Bible Society of Egypt, ℗ Bible Society of Egypt**, artist
Faith Comes By Hearing, composer Hosanna - Faith Comes By Hearing, dated 2018.
This is a non-dramatic reading, not the NT's dramatised recording, and no
narrator identity is asserted. As with the NT, reuse rights are separate from the
public-domain text and must be confirmed before public distribution.

## Canonical chapter audio

`chapter-catalog.json` lists all **1,189** chapters; `chapters/<USFM>/<n>.json`
holds a version-2 manifest per chapter and `canonical-sources.json` records each
original file name, SHA-256, encoded size and duration. Each original recording
is encoded once, whole, to mono 48 kbps AAC (2,176,242,403 bytes, 98.12 hours;
largest Psalm 119 at 7,664,871 bytes). Media names fingerprint the source hash,
transcript hash, encoding settings and timing.

**Source trim (Job 36).** The original `A18___36_Job_________ARZVDVO1DA.mp3`
reads Job 36:1-33 and then all of Job 37 (which also has its own original). A
forced alignment of the whole file against Job 36 + Job 37 text
(`trims/JOB-36-JOB-37.json`, 57 verses, Job 37 part 268.6-468.94 s, minimum
score 0.5327) and detected silence 266.867-268.659 s fix the cut at 267.75 s,
the midpoint after 36:33 (ends 266.9 s). `source-trims.json` records it; the
build re-derives the end from that evidence and refuses it outside silence.
The trimmed recording is `JOB-36-6ed5b7c644686255de11.m4a` (267.75 s,
1,685,262 bytes); the superseded whole-file encoding
`JOB-36-26fa3a24ae2029ba3164.m4a` (471.30 s, 2,953,613 bytes) is no longer
catalogued and is kept only for rollback.

- **260 NT chapters** reuse the verse timings above unchanged (the transcript
  hashes match the full-Bible text). The recording's own spoken opening before
  verse 1 is an explicit `source` interval, so no verse is highlighted during it.
- **929 OT chapters** have **chapter-level timing only**: no verse cues are
  inferred, verse skip is unavailable and the player says so. A five-chapter OT
  alignment benchmark (GEN 1, LEV 11, PSA 23, PSA 119, ISA 53) ran at about 32×
  real time with no verse under the 0.30 review score; aligning all 929 chapters
  would take roughly 2.4 hours here and has not been run or reviewed.

`scripts/verify-canonical-audio.py` re-checks manifests, fingerprints, alignments
and encoded media, and with `--ot`/`--nt` every original hash; on 23 October 2026
all 1,189 chapters (with the Job 36 trim) and source hashes passed.

## Spoken passage references

`reference-texts.json` holds 537 deterministic draft references, one per plan
passage, all `reviewed: false`. No voice is approved: the stock MMS voice was
rejected for its Arabic pronunciation, and later auditions await review. No
announced daily audio or manifest has been published.

## Timing review queue

The initial automated review flagged the following eight verses (alignment score
below 0.30). Scores are diagnostic model outputs, not calibrated probabilities.
All are inside passages, so none determines a daily passage cut. Low confidence
may still affect verse highlighting or seeking. Review these alongside passage
starts/ends before public release; an unflagged verse is not proof of accuracy.
Times below refer to the original chapter recordings, in seconds.

| Verse     | Day | Start–end     | Score  |
| --------- | --- | ------------- | ------ |
| LUK 2:14  | 3   | 99.86–108.04  | 0.2549 |
| MRK 1:24  | 9   | 195.84–208.34 | 0.0706 |
| MRK 5:9   | 21  | 56.84–67.20   | 0.2868 |
| LUK 8:28  | 22  | 291.42–303.66 | 0.2526 |
| MRK 11:10 | 48  | 75.62–87.48   | 0.0063 |
| LUK 19:38 | 49  | 339.04–348.66 | 0.2219 |
| ACT 12:22 | 80  | 218.30–224.14 | 0.2675 |
| REV 22:17 | 150 | 180.26–193.82 | 0.0087 |
