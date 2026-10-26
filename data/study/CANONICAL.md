# Canonical verse-study data

`canonical.json.gz` extends study to all 31,104 Van Dyck verses in 1,189
chapters. It contains Old Testament original-language tokens, full-Bible
كتاب الحياة and KJV translations, and Hebrew/Aramaic lemma/gloss metadata.
The existing `greek.json` and `lexicon.json` remain the New Testament inputs;
legacy daily resources are generated unchanged. See [LICENSE.md](LICENSE.md)
for the separate data licences.

## Reproduction and source pins

Download the four archives listed in `canonical-sources.json` into a local,
ignored artifact directory. The importer verifies their SHA-256 checksums
before processing; a source refresh requires an explicit reviewed pin change.
STEPBible is pinned to `be4191f0082aeedddb0eff0c02c966292b2bd641`, with the
TTAraSVD OT 4.0.1 dataset. NT source hashes are pinned independently.

```sh
python3 scripts/import-study-full.py \
  --ot /path/to/ot.zip --tbesh /path/to/tbesh.txt \
  --nav /path/to/nav.zip --kjv /path/to/kjv.zip \
  --report artifacts/study-import-report.json
npm run build
```

The importer writes deterministic gzip (timestamp zero) and provenance hashes.
Ordinary builds use only committed data, verify the normalized source and Bible
checksums, and require no network, Python, or source archives.

## Coverage and reviewed exceptions

- All 23,145 OT verses have original-language words; the 7,959 existing NT
  verses retain their Greek tuples unchanged, with an added language tag.
- OT tokens: 468,591 total; 461,037 Hebrew and 7,554 Aramaic. Language follows
  each source grammar part, including mixed Daniel 2:4. Prefixes and suffixes
  remain separate, meaningful elements.
- 452,995 OT tokens have verified Arabic spans. Another 14,928 have no direct
  Arabic equivalent. For 668 tokens in 478 verses, source Arabic wording or
  segmentation could not be matched exactly after normalization: retain the
  original word but publish null spans. No positional replacement is guessed.
- Source Psalm headings are excluded from verse-word lists only after their
  Arabic prefix matches the canonical superscription: 743 tokens in 116 titles.
  The Scripture reader continues to show the original headings.
- TTAraSVD combines 2 Kings 4:43–44 and Psalm 72:19–20. Explicit source Hebrew
  reference prefixes identify the second verse in these two reviewed blocks.
  They are split before Arabic alignment; words are not duplicated across verses.
- In 1 Chronicles 27:12 the final H3227B element has no written surface; in
  Nehemiah 2:13 the final H6555 element has no written surface. Omit those two
  elements rather than fabricate Hebrew. Retain the preceding written elements.
- Eight H9014 maqaf/link elements have no grammar code in the source. Keep the
  punctuation and language, with an empty morphology field.
- H7417I and H5892I are absent from TBESH. Their lemma and gloss come directly
  from the tagged source. No dictionary sense is guessed.

Both translations cover every canonical verse. Normalize the embedded RTL mark
in NAV's Acts 15:25–26 **USFM marker only**, preserving the bridge and Scripture
wording. This corrects the old importer swallowing that bridge into Acts 15:24.
KJV 1 Timothy 6:21 spans canonical 21–22; KJV 3 John 1:14 spans canonical 14–15.
Show each complete KJV verse with its corresponding canonical range label.
These are the only NT translation differences; daily legacy output is unchanged.

TBESH's header contains an additional permission note for its Online Bible
**definitions**. That column is excluded entirely. Only STEP lemma/gloss metadata
is imported; English meanings also remain in TTAraSVD tokens. NT definitions
continue to use the existing TBESG source.

## Publication and budgets

Canonical URLs are `/study/v2/BOOK/CHAPTER/index.json`, with contiguous shared
verse ranges for `.words.json.gz` and `.tr.json`. Word files are compressed JSON
assets decoded on demand by the browser; translations and lexicon shards remain
plain JSON. `/study/v2/lex/H00.json` is an example Strong's-prefix shard.

Every word request is limited to 30,000 compressed bytes and 256 KiB decoded;
translations to 30,000 gzip bytes and lexicon shards to 35,000. Oversized chapters
split only between verses. Current maxima are 20,111 compressed / 103,819 decoded
word bytes, 11,499 translation gzip bytes, and 8,087 lexicon gzip bytes.

A build inventory records generated file hashes. Regeneration removes only
obsolete, unmodified inventory-owned files, preserving legacy and unknown files.
The Cloudflare scanner allows only this exact compressed word path, validates
bounded decompression and resource identity, and scans decoded content for
credentials. Existing deployment limits remain unchanged.

Run `python3 -I -m unittest discover -s scripts/tests -p test_import_study_full.py`
and `node --experimental-strip-types --test tests/study-canonical-data.test.ts`
for source exceptions, coverage, splitting, and publication checks.
