import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Published study attribution matches the source licence notice", () => {
  const read = (path: string) =>
    readFileSync(new URL("../../" + path, import.meta.url));

  assert.deepEqual(
    read("app/public/licenses/study-data.txt"),
    read("data/study/LICENSE.md"),
    "Run the data builder to publish data/study/LICENSE.md verbatim to app/public/licenses/study-data.txt",
  );
});
