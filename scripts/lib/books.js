// Our own book table (USFM, OSIS, STEPBible, Arabic name) from data/books.json.
// The Python tools read the same file (scripts/lib/chronos_tools/books.py);
// tests/fixtures/book-table.json pins both.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./paths.js";

/** The 66 rows of data/books.json, each [usfm, osis, step, name], validated. */
export function readBooks(root = ROOT) {
  const books = JSON.parse(readFileSync(join(root, "data/books.json"), "utf8"));
  if (
    !Array.isArray(books) ||
    books.length !== 66 ||
    books.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== 4 ||
        !row.every((field) => typeof field === "string" && field) ||
        !/^[1-3]?[A-Z]{2,3}$/.test(row[0]),
    ) ||
    new Set(books.map((row) => row[0])).size !== 66
  )
    throw new Error("data/books.json is not the 66-book table");
  return books;
}

/** The set of USFM book codes, in canonical order. */
export function usfmCodes(root = ROOT) {
  return new Set(readBooks(root).map(([usfm]) => usfm));
}

/** Maps an Arabic book name, as written in the reading plan, to its USFM code. */
export function usfmByName(root = ROOT) {
  return new Map(readBooks(root).map(([usfm, , , name]) => [name, usfm]));
}
