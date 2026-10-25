import type { BibleBlock } from "../bible/types.ts";

/** Source offsets count Unicode codepoints, preserving Arabic marks verbatim. */
export function chapterSegments(text: string, blocks: readonly BibleBlock[]) {
  const points = Array.from(text);
  const offsets = [
    ...new Set([
      0,
      ...blocks.map((block) =>
        Math.min(points.length, Math.max(0, block.offset)),
      ),
    ]),
  ].sort((a, b) => a - b);
  return offsets.map((offset, index) => ({
    blocks: blocks.filter(
      (block) => Math.min(points.length, Math.max(0, block.offset)) === offset,
    ),
    text: points.slice(offset, offsets[index + 1] ?? points.length).join(""),
  }));
}
