# Arabic Van Dyck canonical text

The text is the public-domain Arabic Van Dyck Bible distributed by
[eBible](https://ebible.org/bible/details.php?id=arb-vd). The pinned
[USFM archive](https://ebible.org/Scriptures/arb-vd_usfm.zip) has SHA-256
`21097759376591c9d1c4b07440e36cd870e44ec5f44e4a84b215b35f17c7b150`.
This is the same source used for the existing chronological reading plan.
Arabic display names and the conventional 66-book ordering come from the
repository's `data/books.json`.

`source.json.gz` is a committed, normalized build input, rather than generated
public output. `provenance.json` pins the archive, decompressed JSON, gzip and
catalog checksums. Production builds use Node only, with no source download,
Python installation, or untracked archive. `catalog.json` contains only book
names, chapter counts and verse counts; it is small enough to bundle for
immediate URL validation. No chapter text is bundled into the application.

The source contains **66 books, 1,189 chapters, and 31,104 numbered verses**.
All **7,959 unique New Testament verses** match the existing plan exactly;
its seven repeated verse occurrences remain untouched. Numbered Scripture
wording is never rewritten or reordered. USFM whitespace is normalized to
single spaces. The importer rejects unknown block markers, missing books,
chapter/verse gaps, coverage changes, checksum changes and plan text differences.

Structure is separate from numbered verse text:

- **1,998** genuine section headings (`s1`), **120** Psalm superscriptions
  (`d`), and **22** Psalm 119 acrostic labels (`qa`).
- **4,637** paragraph blocks (`p`, plus one `nb`), and the source's one centered
  poetry block (`qc`, Psalm 72:20). Most Psalms use `p` in this archive; no
  additional poetry line breaks are invented.
- Of the **28** paragraph markers carrying payloads, **20** continue a numbered
  verse. Their wording remains in that verse; the paragraph boundary records
  its Unicode codepoint offset. The other **eight** remain unnumbered metadata:
  chapter introductions in Nehemiah 7, Nehemiah 8 and Jeremiah 39, and five
  epistle subscriptions in Romans, Ephesians, Philippians, Colossians and Hebrews.
- Book titles and redundant Psalm chapter labels (`cl`) are represented by the
  catalog/chapter location rather than repeated as section headings.

Blocks retain source order, marker, and a numbered verse anchor. Offset zero
means before that verse; later offsets locate boundaries inside its text.
Unnumbered metadata may also be anchored at the end of the chapter's final verse.
Offsets count Unicode codepoints, so renderers must slice with `Array.from(text)`.
Heading, superscription, acrostic and unnumbered paragraph text never contributes
to numbered-verse/audio transcript hashes.

Regenerate from the pinned archive with the standard library only:

```sh
python3 -I scripts/import-bible.py /path/to/arb-vd_usfm.zip
python3 -I -m unittest discover -s scripts/tests -p 'test_import_bible.py'
npm run build
```

The importer writes deterministic JSON and gzip bytes (fixed gzip timestamp
and OS field). `scripts/build-bible.js` validates source checksums and full
coverage before emitting `/bible/<USFM>/<chapter>.json` into ignored
`public/bible/`. Every chapter is checked against a **12 KiB gzip** delivery
budget; the pinned source's largest chapter is **6,170 bytes gzip** including
structural metadata. The canonical text builder does not change `data/plan.json`.
