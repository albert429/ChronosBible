/** Natural verse boundaries and deterministic grouping near the word target. */
import { verseKey } from "./source.js";

/**
 * Conservative reading pace. The only measured timing in the repository is
 * the New Testament audio drama (82.3 words/minute over 260 chapters); 80 is
 * used for both testaments so estimates stay consistent and slightly long.
 */
export const WORDS_PER_MINUTE = 80;
export const TARGET_MINUTES = 10;
export const TARGET_WORDS = TARGET_MINUTES * WORDS_PER_MINUTE;

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

/**
 * One item per verse read, in order. `natural` marks a place a reading may
 * begin, from canonical structure only: a chapter start, the verse after a
 * chapter's last verse, or a section heading/acrostic that starts the verse.
 * Source group (daily) boundaries are not breaks on their own.
 */
export function verseSequence(occurrences, chapterOf) {
  const items = [];
  let afterChapterEnd = false;
  for (const occurrence of occurrences) {
    const chapter = chapterOf(occurrence.usfm, occurrence.chapter);
    const count = chapter.passages[0].verses.length;
    const sections = new Set(
      chapter.structure
        .filter(
          (block) =>
            (block.kind === "heading" || block.kind === "acrostic") &&
            block.offset === 0,
        )
        .map((block) => block.verse),
    );
    for (let verse = occurrence.from; verse <= occurrence.to; verse++) {
      items.push({
        occurrence,
        verse,
        words: wordCount(chapter.passages[0].verses[verse - 1].text),
        natural: afterChapterEnd || verse === 1 || sections.has(verse),
      });
      afterChapterEnd = verse === count;
    }
  }
  return items;
}

/** Item index where each stage (and substage) starts. */
export function stageStarts(stages, items) {
  const at = (start, where) => {
    const index = items.findIndex(
      (item) =>
        item.occurrence.id === start.occurrence &&
        item.verse === (start.verse ?? item.occurrence.from),
    );
    const item = items[index];
    if (
      !item ||
      verseKey(item.occurrence.usfm, item.occurrence.chapter, item.verse) !==
        start.first
    )
      throw new Error(`${where} does not start at ${start.first}`);
    return index;
  };
  const starts = stages.map((stage) => ({
    stage: stage.id,
    index: at(stage.start, `Stage ${stage.id}`),
    substages: (stage.substages ?? []).map((sub) => ({
      id: sub.id,
      index: at(sub.start, `Substage ${sub.id}`),
    })),
  }));
  const order = starts.flatMap((s) =>
    s.substages.length ? s.substages.map((sub) => sub.index) : [s.index],
  );
  if (
    starts.some((s) => s.substages.length && s.substages[0].index !== s.index)
  )
    throw new Error("A stage must start with its first substage");
  if (order[0] !== 0 || order.some((n, i) => i && n <= order[i - 1]))
    throw new Error("Stage boundaries must follow the source order");
  return starts;
}

/**
 * Greedy grouping of items [start, end) into readings near `target` words.
 * Each break is the natural boundary whose running total is nearest the
 * target; on a tie the earlier boundary wins. `end` (a stage or substage
 * boundary) is always a break, so a stage may end with a short reading.
 */
export function groupSegment(items, start, end, target = TARGET_WORDS) {
  const total = [0];
  for (let i = start; i < end; i++) total.push(total.at(-1) + items[i].words);
  const words = (from, to) => total[to - start] - total[from - start];
  const breaks = [];
  for (let i = start + 1; i < end; i++) if (items[i].natural) breaks.push(i);
  breaks.push(end);
  const ends = [];
  let s = start;
  while (s < end) {
    const after = breaks.filter((b) => b > s);
    const over = after.findIndex((b) => words(s, b) >= target);
    let choice = end;
    if (over >= 0) {
      const under = over > 0 ? after[over - 1] : undefined;
      choice =
        under !== undefined &&
        target - words(s, under) <= words(s, after[over]) - target
          ? under
          : after[over];
    }
    ends.push(choice);
    s = choice;
  }
  return ends;
}
