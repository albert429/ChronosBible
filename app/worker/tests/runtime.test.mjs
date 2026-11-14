import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, answerScript, assetResponse, ORIGIN } from "./harness.mjs";
const events = (text) =>
  text
    .split("\n\n")
    .filter(Boolean)
    .map((s) => ({
      event: s.match(/^event: (.+)/)?.[1],
      data: JSON.parse(s.match(/\ndata: (.+)/)[1]),
    }));

test("Worker contract, canonical material, shared caching and counted fallback", async () => {
  const h = await harness();
  try {
    const cookie = await h.identify();
    for (const input of [
      { verseId: "MAT.8.999" },
      { verseId: "../GEN.1.1" },
      { prompt: "inject" },
      { model: "paid" },
      { max_tokens: 1 },
      { chip: "ask", question: "x" },
      { chip: "ask", question: "x".repeat(201) },
    ]) {
      assert.equal((await h.answer(input, cookie)).status, 400);
    }
    assert.equal(
      (
        await h.answer({}, cookie, {
          headers: {
            Origin: "https://elsewhere.test",
            "Content-Type": "application/json",
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (await h.answer({ turnstileToken: "invalid" }, cookie)).status,
      403,
    );
    assert.equal((await h.answer({}, "__Host-chronos-ai=forged")).status, 403);
    const result = await h.answer({ turnstileToken: "once" }, cookie);
    assert.equal(result.status, 200);
    const stream = events(await result.text());
    assert.equal(stream.at(-1).event, "done");
    assert.equal(h.log.length, 1);
    assert.match(h.log[0].body.messages[1].content, /8:12–18/);
    assert.equal(h.log[0].body.max_tokens, 2000);
    assert.equal(h.log[0].headers.cookie, undefined);
    assert.equal(h.log[0].headers["cf-connecting-ip"], undefined);
    assert.equal(h.log[0].headers["cf-aig-max-attempts"], "1");
    assert.equal(h.log[0].headers["cf-aig-collect-log-payload"], "false");
    assert.equal(
      (await h.answer({ turnstileToken: "once" }, cookie)).status,
      403,
    );
    const other = await h.identify();
    const cached = events(await (await h.answer({}, other)).text());
    assert.equal(cached[0].data.cached, true);
    assert.equal(h.log.length, 1);
    assert.equal(cached.find((e) => e.event === "quota").data.usage.answers, 0);
    let attempts = 0;
    h.gateway(async () =>
      ++attempts === 1
        ? Response.json({ error: { message: "stale" } }, { status: 404 })
        : answerScript("جواب جديد"),
    );
    const fresh = events(
      await (await h.answer({ fresh: true }, cookie)).text(),
    );
    assert.equal(fresh.at(-1).event, "done");
    assert.equal(attempts, 2);
    assert.deepEqual((await (await h.status(cookie)).json()).usage, {
      answers: 2,
      attempts: 3,
    });
    assert.equal(h.log[1].body.model, "google/gemma-4-31b-it:free");
    assert.equal(h.log[2].body.model, "google/gemma-4-26b-a4b-it:free");
  } finally {
    await h.close();
  }
});

test("SQLite atomic reservations, expirations, budgets, persistence and fail closed", async () => {
  const persist = await mkdtemp(join(tmpdir(), "chronos-worker-"));
  let h = await harness({ persist });
  try {
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        h.ledger({ action: "reserve", id: `r${i}`, device: `d${i}`, now }),
      ),
    );
    assert.equal(results.filter((r) => !r.kind).length, 3);
    assert.equal(results.filter((r) => r.kind === "busy").length, 9);
    await h.ledger({ action: "cleanup", now: now + 130000 });
    assert.equal((await h.sql("SELECT * FROM leases")).length, 0);
    await h.ledger({ action: "reserve", id: "saved", now: now + 130000 });
    await h.ledger({ action: "attempt", id: "saved", now: now + 130000 });
    await h.ledger({ action: "answered", id: "saved", now: now + 130000 });
    await h.close();
    h = await harness({ persist });
    assert.deepEqual(
      (await h.ledger({ action: "status", now: now + 130000 })).usage,
      { answers: 1, attempts: 1 },
    );
    await h.sql("DROP TABLE counters");
    const failed = await h.answer();
    assert.equal(failed.status, 503);
    assert.equal(h.log.length, 0);
  } finally {
    await h.close();
    await rm(persist, { recursive: true, force: true });
  }
});

test("Failed, partial, truncated, typed and degraded answers never enter shared cache", async () => {
  const h = await harness();
  try {
    const cookie = await h.identify();
    h.gateway(async () => answerScript("س".repeat(6100)));
    let stream = events(await (await h.answer({}, cookie)).text());
    assert.equal(stream.at(-1).data.finish, "length");
    assert.equal(
      stream.find((e) => e.event === "delta").data.text.length,
      6000,
    );
    assert.equal((await h.sql("SELECT * FROM answers")).length, 0);
    h.gateway(
      async () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"جزء"}}]}\n\ndata: {"error":{"code":500}}\n\n',
        ),
    );
    stream = events(await (await h.answer({}, cookie)).text());
    assert.equal(stream.at(-1).event, "error");
    assert.equal(h.log.length, 2);
    h.gateway(async () => answerScript());
    await (
      await h.answer({ chip: "ask", question: "ما معنى الآية؟" }, cookie)
    ).text();
    h.assets((r) =>
      new URL(r.url).pathname.includes("/study/")
        ? new Response(null, { status: 404 })
        : assetResponse(r),
    );
    await (await h.answer({}, cookie)).text();
    assert.equal((await h.sql("SELECT * FROM answers")).length, 0);
  } finally {
    await h.close();
  }
});

test("Runtime disabled switch blocks execution and leaves static assets routable", async () => {
  const h = await harness({ bindings: { AI_ENABLED: "false" } });
  try {
    assert.equal((await (await h.status()).json()).available, false);
    assert.equal((await h.answer()).status, 503);
    assert.equal(
      (await h.mf.dispatchFetch(ORIGIN + "/bible/GEN/1.json")).status,
      200,
    );
    assert.equal(h.log.length, 0);
  } finally {
    await h.close();
  }
});

test("Provider day/minute budgets, browser attempts and Cairo/UTC rollover are independent", async () => {
  const h = await harness();
  try {
    const now = Date.parse("2026-11-03T21:59:58Z");
    const state = await h.ledger({ action: "status", now });
    assert.equal(state.resets.device, Date.parse("2026-11-03T22:00:00Z"));
    assert.equal(state.resets.provider, Date.parse("2026-11-04T00:00:00Z"));
    await h.ledger({ action: "reserve", id: "one", now });
    for (let i = 0; i < 15; i++)
      assert.equal(
        (await h.ledger({ action: "attempt", id: "one", now })).kind,
        undefined,
      );
    assert.equal(
      (await h.ledger({ action: "attempt", id: "one", now })).kind,
      "rate",
    );
    for (let i = 0; i < 5; i++)
      await h.ledger({ action: "attempt", id: "one", now: now + 61000 });
    assert.equal(
      (await h.ledger({ action: "attempt", id: "one", now: now + 61000 })).kind,
      "attempts",
    );
    await h.sql("UPDATE counters SET a=40 WHERE key LIKE 'p:%'");
    await h.ledger({
      action: "reserve",
      id: "two",
      device: "two",
      now: now + 61000,
    });
    assert.equal(
      (await h.ledger({ action: "attempt", id: "two", now: now + 61000 })).kind,
      "quota",
    );
    await h.sql("DELETE FROM leases");
    const tomorrow = Date.parse("2026-11-04T00:00:01Z");
    await h.ledger({
      action: "reserve",
      id: "new",
      device: "test",
      now: tomorrow,
    });
    assert.deepEqual(
      (await h.ledger({ action: "attempt", id: "new", now: tomorrow })).usage,
      { answers: 0, attempts: 1 },
    );
    await h.ledger({ action: "cleanup", now: tomorrow + 48 * 3600000 });
    assert.equal((await h.sql("SELECT * FROM counters")).length, 0);
    const dst = await h.ledger({
      action: "status",
      now: Date.parse("2026-04-23T21:30:00Z"),
    });
    assert.equal(dst.resets.device, Date.parse("2026-04-23T22:00:00Z"));
  } finally {
    await h.close();
  }
});

test("Cached answers survive provider exhaustion; expiry and data revision invalidate them", async () => {
  const h = await harness();
  try {
    const cookie = await h.identify();
    await (await h.answer({}, cookie)).text();
    await h.sql("UPDATE counters SET a=40 WHERE key LIKE 'p:%'");
    assert.equal(
      events(await (await h.answer({}, cookie)).text())[0].data.cached,
      true,
    );
    assert.equal(
      events(await (await h.answer({ fresh: true }, cookie)).text()).at(-1).data
        .kind,
      "quota",
    );
    await h.sql("UPDATE counters SET a=1 WHERE key LIKE 'p:%'");
    await h.sql("UPDATE answers SET expires=0");
    await (await h.answer({}, cookie)).text();
    assert.equal(h.log.length, 2);
    h.assets((r) =>
      new URL(r.url).pathname === "/ai-data-version.json"
        ? Response.json({ bible: "aaaaaaaaaa", study: "bbbbbbbbbb" })
        : assetResponse(r),
    );
    await (await h.answer({}, cookie)).text();
    assert.equal(h.log.length, 3);
  } finally {
    await h.close();
  }
});

test("Oversized bodies, non-string chips and wrong Turnstile hostname/action/age are rejected", async () => {
  const h = await harness();
  try {
    const cookie = await h.identify();
    assert.equal((await h.answer({ chip: ["explain"] }, cookie)).status, 400);
    assert.equal(
      (await h.answer({ question: "x".repeat(17000) }, cookie)).status,
      400,
    );
    for (const change of [
      { hostname: "elsewhere.test" },
      { action: "wrong" },
      { challenge_ts: "2020-01-01T00:00:00Z" },
    ]) {
      h.turnstile({
        success: true,
        hostname: "chronos.test",
        action: "ai_answer",
        challenge_ts: new Date().toISOString(),
        ...change,
      });
      assert.equal((await h.answer({}, cookie)).status, 403);
    }
    assert.equal(h.log.length, 0);
  } finally {
    await h.close();
  }
});

test("Dev has its separate five/minute budget; the shared cache keeps at most 1,000 entries", async () => {
  const h = await harness({ bindings: { AI_ENVIRONMENT: "dev" } });
  try {
    const now = Date.now();
    await h.ledger({ action: "reserve", id: "dev", now, environment: "dev" });
    for (let i = 0; i < 5; i++)
      await h.ledger({ action: "attempt", id: "dev", now, environment: "dev" });
    assert.equal(
      (
        await h.ledger({
          action: "attempt",
          id: "dev",
          now,
          environment: "dev",
        })
      ).kind,
      "rate",
    );
    for (let i = 0; i < 5; i++)
      await h.ledger({
        action: "attempt",
        id: "dev",
        now: now + 61000,
        environment: "dev",
      });
    assert.equal(
      (
        await h.ledger({
          action: "attempt",
          id: "dev",
          now: now + 61000,
          environment: "dev",
        })
      ).kind,
      "quota",
    );
    await h.ledger({ action: "fillCache", now });
    assert.equal((await h.sql("SELECT count(*) AS n FROM answers"))[0].n, 1000);
    assert.equal(
      (await h.sql("SELECT * FROM answers WHERE key='test-0'")).length,
      0,
    );
    assert.equal(
      (await h.sql("SELECT * FROM answers WHERE key='test-1004'")).length,
      1,
    );
  } finally {
    await h.close();
  }
});

test("Canonical OT/NT context keeps original languages and at most four asset reads", async () => {
  const h = await harness();
  let active = 0,
    peak = 0;
  try {
    h.assets(async (r) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise((r) => setTimeout(r, 2));
        return await assetResponse(r);
      } finally {
        active--;
      }
    });
    const cookie = await h.identify();
    for (const verseId of ["GEN.1.1", "DAN.2.4", "MAT.8.15"]) {
      const stream = events(
        await (await h.answer({ verseId, chip: "words" }, cookie)).text(),
      );
      assert.equal(stream.at(-1).event, "done");
    }
    assert.ok(peak <= 4, `active assets: ${peak}`);
    assert.match(h.log[0].body.messages[1].content, /الكلمات العبرية/);
    assert.match(h.log[1].body.messages[1].content, /الآرامية/);
    assert.match(h.log[2].body.messages[1].content, /الكلمات اليونانية/);
  } finally {
    await h.close();
  }
});
