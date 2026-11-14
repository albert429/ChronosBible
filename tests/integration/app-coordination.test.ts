import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseTrack, createChoiceGuard } from "../../src/app/trackChoice.ts";
import { pagingTarget, type PagingKey } from "../../src/app/keyboardPaging.ts";
import { documentTitle } from "../../src/app/useDocumentTitle.ts";
import type { ChronologyCatalog } from "../../src/core/reading/chronology.ts";
import type { ChronologicalLocation } from "../../src/core/reading/types.ts";

const catalog = (testament: "OT" | "NT", id: string) =>
  ({
    testament,
    stages: [],
    readings: [{ id, title: id, stage: 0 }],
  }) as unknown as ChronologyCatalog;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("a pending choice is superseded by later choices, navigation and reader changes", () => {
  // Each render records fresh marks, as the session's layout effect does.
  let marks = { navigation: 0, switches: 0 };
  const guard = createChoiceGuard(() => marks);
  let superseded = guard.begin();
  assert.equal(superseded(), false);
  // A later asynchronous choice, or one applied at once (go, a reader pick).
  guard.begin();
  assert.equal(superseded(), true);
  superseded = guard.begin();
  guard.supersede();
  assert.equal(superseded(), true);
  // Any navigation, including Back, after the choice began.
  superseded = guard.begin();
  marks = { ...marks, navigation: marks.navigation + 1 };
  assert.equal(superseded(), true);
  // Another active reader (or re-selecting the same one).
  superseded = guard.begin();
  marks = { ...marks, switches: marks.switches + 1 };
  assert.equal(superseded(), true);
  // Changes before the choice began do not count.
  superseded = guard.begin();
  assert.equal(superseded(), false);
});

test("choosing a track opens a known place at once and a new chronology on its first reading", async () => {
  const opened: [string, ChronologicalLocation?][] = [];
  const open = (track: string, start?: ChronologicalLocation) => {
    opened.push([track, start]);
    return track === "bible" || !!start;
  };
  let loads = 0;
  const load = async (testament: "OT" | "NT") => {
    loads++;
    return catalog(testament, "first");
  };
  assert.equal(await chooseTrack("bible", () => false, open, load), true);
  assert.equal(loads, 0);
  assert.equal(await chooseTrack("chrono:NT", () => false, open, load), true);
  assert.deepEqual(opened.at(-1), [
    "chrono:NT",
    { mode: "chronological", testament: "NT", readingId: "first" },
  ]);
  assert.equal(loads, 1);
});

test("a chronology choice superseded while its catalog loads never applies or reports", async () => {
  let superseded = false;
  const opened: string[] = [];
  const open = (track: string, start?: ChronologicalLocation) => {
    if (start) opened.push(track);
    return !!start;
  };
  const pending = deferred<ChronologyCatalog>();
  const choice = chooseTrack(
    "chrono:OT",
    () => superseded,
    open,
    () => pending.promise,
  );
  superseded = true;
  pending.resolve(catalog("OT", "first"));
  assert.equal(await choice, false);
  assert.deepEqual(opened, []);
  // A failure after a newer choice is dropped; a current one is reported.
  const failing = deferred<ChronologyCatalog>();
  const stale = chooseTrack(
    "chrono:OT",
    () => true,
    open,
    () => failing.promise,
  );
  failing.reject(Error("down"));
  assert.equal(await stale, false);
  await assert.rejects(
    chooseTrack(
      "chrono:NT",
      () => false,
      open,
      async () => {
        throw Error("تعذر تحميل فهرس");
      },
    ),
    /تعذر تحميل فهرس/,
  );
  assert.deepEqual(opened, []);
});

const key = (event: Partial<PagingKey>): PagingKey => ({
  key: "ArrowLeft",
  defaultPrevented: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  target: null,
  ...event,
});
const element = (matches: boolean) =>
  ({ closest: () => (matches ? {} : null) }) as unknown as EventTarget;

test("arrow keys page right to left, except with modifiers, in fields or under a dialog", () => {
  const closed = () => false;
  assert.equal(pagingTarget(key({}), "previous", "next", closed), "next");
  assert.equal(
    pagingTarget(key({ key: "ArrowRight" }), "previous", "next", closed),
    "previous",
  );
  assert.equal(
    pagingTarget(key({ key: "ArrowUp" }), "previous", "next", closed),
    undefined,
  );
  // At either end of a mode there is nothing to page to.
  assert.equal(pagingTarget(key({}), "previous", undefined, closed), undefined);
  for (const exclusion of [
    { defaultPrevented: true },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { target: element(true) },
  ]) {
    let asked = false;
    const dialogOpen = () => (asked = true);
    assert.equal(
      pagingTarget(key(exclusion), "previous", "next", dialogOpen),
      undefined,
    );
    // The open-dialog query is the last, and only, DOM lookup.
    assert.equal(asked, false);
  }
  assert.equal(
    pagingTarget(key({ target: element(false) }), "previous", "next", closed),
    "next",
  );
  assert.equal(
    pagingTarget(key({}), "previous", "next", () => true),
    undefined,
  );
});

test("the tab title names the reading, or the plan on its calendar", () => {
  assert.equal(documentTitle("read", "تكوين ١"), "تكوين ١ · الكتاب المقدس");
  assert.equal(documentTitle("read", ""), "الكتاب المقدس");
  assert.equal(
    documentTitle("calendar", "تكوين ١"),
    "العهد الجديد في ١٥٠ يومًا · الكتاب المقدس",
  );
});
