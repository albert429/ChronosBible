import type { BibleChapter } from "../src/domain/reading/types.ts";
import type {
  StudyChapterIndex,
  StudyWords,
  StudyTranslations,
  StudyLexicon,
} from "../src/domain/study/types.ts";
import {
  STUDY_WORDS_GZIP_LIMIT,
  STUDY_WORDS_RAW_LIMIT,
} from "../src/domain/study/limits.ts";
import { PROMPT_VERSION } from "../src/domain/ai/chips.ts";
import { AiError, type ChipId } from "../src/domain/ai/types.ts";
import type { Material } from "./prompt.ts";
import { reference } from "./validation.ts";
import { bytes } from "./http.ts";

/** One reader per Object: at most four active asset reads across requests. */
export class Assets {
  private active = 0;
  private waiting: (() => void)[] = [];
  private binding: Fetcher;
  constructor(binding: Fetcher) {
    this.binding = binding;
  }
  async read<T>(path: string, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= 4)
      await new Promise<void>((resolve, reject) => {
        const stop = () => {
          this.waiting = this.waiting.filter((f) => f !== go);
          reject(new AiError("aborted"));
        };
        const go = () => {
          signal.removeEventListener("abort", stop);
          this.active++;
          resolve();
        };
        this.waiting.push(go);
        signal.addEventListener("abort", stop, { once: true });
      });
    else this.active++;
    try {
      signal.throwIfAborted();
      const response = await this.binding.fetch(
        new Request(`https://assets.invalid${path}`, { signal }),
      );
      if (!response.ok) throw new AiError("unavailable");
      let data = await bytes(response.body, STUDY_WORDS_RAW_LIMIT, signal);
      if (data[0] === 0x1f && data[1] === 0x8b) {
        if (data.length > STUDY_WORDS_GZIP_LIMIT)
          throw new AiError("unavailable");
        data = await bytes(
          new Blob([data])
            .stream()
            .pipeThrough(new DecompressionStream("gzip")),
          STUDY_WORDS_RAW_LIMIT,
          signal,
        );
      }
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
          data,
        ),
      ) as T;
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
  async revision(signal: AbortSignal) {
    const data = await this.read<{ bible: string; study: string }>(
      "/ai-data-version.json",
      signal,
    );
    if (
      !/^[a-f0-9]{10}$/.test(data.bible) ||
      !/^[a-f0-9]{10}$/.test(data.study)
    )
      throw new AiError("unavailable");
    return `${PROMPT_VERSION}:${data.bible}:${data.study}`;
  }
  async material(id: string, chip: ChipId, signal: AbortSignal) {
    const { book, chapter, verse } = reference(id);
    const data = await this.read<BibleChapter>(
      `/bible/${book.usfm}/${chapter}.json`,
      signal,
    );
    const passage = data.passages?.[0];
    if (
      data.mode !== "bible" ||
      data.usfm !== book.usfm ||
      data.chapter !== chapter ||
      !passage ||
      passage.verses?.length !== book.verseCounts[chapter - 1] ||
      !passage.verses.every(
        (v, i) => v.number === i + 1 && typeof v.text === "string" && !!v.text,
      )
    )
      throw new AiError("unavailable");
    // Canonical headings may be structural rather than attached to verse text.
    const verses = passage.verses.map((v) => ({ ...v }));
    for (const block of data.structure ?? [])
      if (block.kind === "heading" && block.text && verses[block.verse - 1])
        verses[block.verse - 1].heading = block.text;
    const material: Material = {
      book: book.name,
      passage: { ...passage, verses },
      verse: verses[verse - 1],
    };
    let complete = true;
    try {
      const prefix = `/study/v2/${book.usfm}/${chapter}`;
      const index = await this.read<StudyChapterIndex>(
        `${prefix}/index.json`,
        signal,
      );
      if (
        index.v !== 2 ||
        index.book !== book.usfm ||
        index.chapter !== chapter
      )
        throw new Error();
      const range = index.ranges.find(
        (r) => verse >= r.start && verse <= r.end,
      );
      if (!range || !/^\d+-\d+$/.test(range.key)) throw new Error();
      const path = `${prefix}/${range.key}`;
      const optional = async (load: () => Promise<void>) => {
        try {
          await load();
        } catch {
          complete = false;
        }
      };
      await Promise.all([
        optional(async () => {
          const tr = await this.read<StudyTranslations>(
            `${path}.tr.json`,
            signal,
          );
          if (
            tr.book !== book.usfm ||
            tr.chapter !== chapter ||
            !tr.verses[verse]
          )
            throw new Error();
          material.tr = tr.verses[verse];
        }),
        optional(async () => {
          if (chip !== "words" && chip !== "ask") return;
          const words = await this.read<StudyWords>(
            `${path}.words.json.gz`,
            signal,
          );
          if (
            words.book !== book.usfm ||
            words.chapter !== chapter ||
            !words.verses[verse]
          )
            throw new Error();
          material.words = words.verses[verse].w;
          material.lex = {};
          const shards = [
            ...new Set(material.words.map((w) => w[2].slice(0, 3))),
          ];
          await Promise.all(
            shards.map((shard) =>
              optional(async () => {
                if (!/^[GH]\d{2}$/.test(shard)) throw new Error();
                const lex = await this.read<StudyLexicon>(
                  `/study/v2/lex/${shard}.json`,
                  signal,
                );
                if (lex.shard !== shard || !lex.lex) throw new Error();
                Object.assign(material.lex!, lex.lex);
              }),
            ),
          );
        }),
      ]);
    } catch {
      complete = false;
    }
    signal.throwIfAborted();
    return { material, complete };
  }
}
