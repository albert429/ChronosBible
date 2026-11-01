import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Published study attribution matches the source licence notice", () => {
  const read = (path: string) =>
    readFileSync(new URL("../" + path, import.meta.url), "utf8");

  assert.equal(
    read("public/licenses/study-data.txt"),
    read("data/study/LICENSE.md"),
    "Copy data/study/LICENSE.md to public/licenses/study-data.txt when study attribution changes",
  );
});
