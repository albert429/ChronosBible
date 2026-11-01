import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { usfmByName } from "../scripts/lib/books.js";

// Shared with scripts/tests/test_chronos_tools.py: both languages read
// data/books.json and must agree with these pinned rows.
const golden = JSON.parse(
  readFileSync(new URL("./fixtures/book-table.json", import.meta.url), "utf8"),
);
const table: string[][] = JSON.parse(
  readFileSync(new URL("../data/books.json", import.meta.url), "utf8"),
);

test("The script book table matches the golden fixture shared with the Python tools", () => {
  assert.equal(table.length, golden.count);
  assert.equal(new Set(table.map((row) => row[0])).size, golden.count);
  for (const book of golden.books) {
    assert.deepEqual(table[book.index], [
      book.usfm,
      book.osis,
      book.step,
      book.name,
    ]);
  }
});

test("usfmByName maps every Arabic book name to its USFM code", () => {
  const byName = usfmByName();
  assert.equal(byName.size, golden.count);
  for (const book of golden.books) {
    assert.equal(byName.get(book.name), book.usfm);
  }
});
