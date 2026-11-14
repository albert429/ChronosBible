/**
 * Size limits for canonical word resources (`RANGE.words.json.gz`; see
 * data/study/CANONICAL.md). Pure numbers, so build and hosting checks can
 * share them; each environment decodes with its own adapter.
 */
/** Stored (gzip) bytes of one word range. */
export const STUDY_WORDS_GZIP_LIMIT = 30000;
/** Decoded bytes of one word range, and the most read from any response. */
export const STUDY_WORDS_RAW_LIMIT = 256 * 1024;
