import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadingsClients } from "../../src/features/plan/data/client.ts";
import type { Day, PlanEntry } from "../../src/core/reading/types.ts";
import { scheduledDay, dayIndex } from "../../src/core/reading/schedule.ts";

const day = (n: number): Day => ({
  day: n,
  verseCount: 1,
  passages: [
    {
      book: "متى",
      chapter: 1,
      start: 1,
      end: 1,
      verses: [{ number: 1, text: "نص" }],
    },
  ],
});
test("Readings for the wrong day are rejected and can be retried without poisoned cache", async () => {
  let requests = 0;
  const client = createReadingsClients(async () =>
    Response.json(++requests === 1 ? day(3) : day(2)),
  ).days;
  await assert.rejects(client.load("2"), /تعذر تحميل القراءة/);
  assert.equal(client.peek("2"), undefined);
  assert.deepEqual(await client.load("2"), day(2));
  assert.equal(requests, 2);
});
test("Calendar failures are separate from cached readings", async () => {
  const urls: string[] = [];
  const { planIndex, days } = createReadingsClients(async (url) => {
    urls.push(String(url));
    return String(url).endsWith("plan.json")
      ? new Response("failed", { status: 500 })
      : Response.json(day(1));
  });
  await days.load("1");
  assert.deepEqual(urls, ["/readings/1.json"]);
  await assert.rejects(planIndex.load("plan"), /تعذر تحميل خطة القراءة/);
  assert.deepEqual(days.peek("1"), day(1));
  assert.deepEqual(urls, ["/readings/1.json", "/readings/plan.json"]);
});
test("The plan index holds 150 entries without verses and rejects anything else", async () => {
  const entry = (n: number): PlanEntry => ({
    day: n,
    verseCount: 1,
    passages: [{ book: "متى", chapter: 1, start: 1, end: 1 }],
  });
  const full = Array.from({ length: 150 }, (_, i) => entry(i + 1));
  let body: unknown = full;
  const { planIndex } = createReadingsClients(async () => Response.json(body));
  body = full.slice(1);
  await assert.rejects(planIndex.load("plan"), /تعذر تحميل خطة القراءة/);
  assert.equal(planIndex.peek("plan"), undefined);
  body = full;
  assert.deepEqual(await planIndex.load("plan"), full);
});
test("Speculative reads share foreground requests, respect bounds, and retry failures", async () => {
  let requests = 0;
  let resolve: (response: Response) => void = () => {};
  const client = createReadingsClients(() => {
    requests++;
    return new Promise((done) => {
      resolve = done;
    });
  }).days;
  await Promise.all([0, 151, NaN, 1.5].map(client.prefetchDay));
  assert.equal(requests, 0);
  const warm = client.prefetchDay(2);
  const foreground = client.load("2");
  await Promise.resolve();
  assert.equal(requests, 1);
  resolve(Response.json(day(2)));
  await warm;
  assert.deepEqual(await foreground, day(2));
  await client.prefetchDay(2);
  assert.equal(requests, 1);

  let attempts = 0;
  const retryable = createReadingsClients(async () =>
    ++attempts === 1
      ? new Response("failed", { status: 503 })
      : Response.json(day(3)),
  ).days;
  await retryable.prefetchDay(3);
  assert.equal(retryable.peek("3"), undefined);
  assert.deepEqual(await retryable.load("3"), day(3));
  assert.equal(attempts, 2);
});
test("Cairo calendar dates preserve catch-up schedule and day boundaries", () => {
  assert.equal(dayIndex("2026-09-22", "2026-10-01"), 10);
  assert.equal(scheduledDay("2026-10-02", "2026-10-01"), 1);
  assert.equal(scheduledDay("2025-01-01", "2026-10-01"), 150);
});
