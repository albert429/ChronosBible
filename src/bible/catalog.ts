import books from "../../data/bible/catalog.json" with { type: "json" };
import type { BibleBook } from "./types.ts";

/** Small navigation data only; chapter Scripture is always loaded on demand. */
export const catalog: BibleBook[] = books as BibleBook[];
