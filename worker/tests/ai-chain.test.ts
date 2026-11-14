import type { AiRequest } from "../types.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runChain } from "../chain.ts";
import {
  AiError,
  type AiErrorKind,
  type AiMeta,
  type StreamCallbacks,
} from "../../src/features/ai/domain/types.ts";

const request: AiRequest = { system: "s", prompt: "p", maxOutputTokens: 10 };
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new AiError("aborted"));
    });
  });
/** A provider that runs a script of steps against the callbacks. */
type Script = (
  signal: AbortSignal,
  cb: Required<StreamCallbacks>,
) => Promise<AiMeta | void>;
const provider = (id: string, script: Script) => ({
  id,
  calls: 0,
  async stream(
    this: { calls: number },
    _req: AiRequest,
    signal: AbortSignal,
    cb: Required<StreamCallbacks>,
  ) {
    this.calls++;
    return (await script(signal, cb)) as AiMeta;
  },
});
const collect = () => {
  const seen = { text: "", meta: [] as string[], activity: 0 };
  return {
    seen,
    cb: {
      onText: (t: string) => (seen.text += t),
      onMeta: (m: string) => seen.meta.push(m),
      onActivity: () => seen.activity++,
    },
  };
};
const fast = { firstTokenMs: 60, ceilingMs: 200, idleMs: 60 };
const kindOf = (kind: AiErrorKind, after?: boolean) => (e: unknown) => {
  assert.ok(e instanceof AiError);
  assert.equal(e.kind, kind);
  if (after !== undefined) assert.equal(e.afterFirstToken, after);
  return true;
};

test("Falls through to the next provider on failures before any text", async () => {
  for (const kind of [
    "server",
    "timeout",
    "empty",
    "network",
    "unavailable",
  ] as const) {
    const a = provider("a", async () => {
      throw new AiError(kind);
    });
    const b = provider("b", async (_s, cb) => {
      cb.onMeta("b/model:free");
      cb.onText("ok");
      return { provider: "b", model: "b/model:free", finish: "stop" };
    });
    const { seen, cb } = collect();
    const meta = await runChain(
      [a, b],
      request,
      new AbortController().signal,
      cb,
      fast,
    );
    assert.equal(meta.provider, "b", kind);
    assert.equal(seen.text, "ok");
  }
});

test("Auth disables a provider for later calls; all disabled is auth", async () => {
  const disabled = new Set<string>();
  const a = provider("a", async () => {
    throw new AiError("auth");
  });
  await assert.rejects(
    runChain([a], request, new AbortController().signal, collect().cb, {
      ...fast,
      disabled,
    }),
    kindOf("auth"),
  );
  assert.ok(disabled.has("a"));
  await assert.rejects(
    runChain([a], request, new AbortController().signal, collect().cb, {
      ...fast,
      disabled,
    }),
    kindOf("auth"),
  );
  assert.equal(a.calls, 1);
});

test("An error after text is final: partial text kept, next provider never tried", async () => {
  const a = provider("a", async (_s, cb) => {
    cb.onMeta("a/model:free");
    cb.onText("نصف ");
    throw new AiError("server");
  });
  const b = provider("b", async () => ({
    provider: "b",
    model: "b",
    finish: "stop",
  }));
  const { seen, cb } = collect();
  await assert.rejects(
    runChain([a, b], request, new AbortController().signal, cb, fast),
    (e: unknown) => {
      kindOf("server", true)(e);
      assert.ok(e instanceof AiError);
      assert.equal(e.model, "a/model:free");
      return true;
    },
  );
  assert.equal(seen.text, "نصف ");
  assert.equal(b.calls, 0);
});

test("An idle stall after the first chunk is a timeout with afterFirstToken", async () => {
  const a = provider("a", async (signal, cb) => {
    cb.onText("بداية");
    await sleep(1000, signal);
    return { provider: "a", model: "a", finish: "stop" };
  });
  const b = provider("b", async () => ({
    provider: "b",
    model: "b",
    finish: "stop",
  }));
  await assert.rejects(
    runChain([a, b], request, new AbortController().signal, collect().cb, fast),
    kindOf("timeout", true),
  );
  assert.equal(b.calls, 0);
});

test("Activity extends the first-token wait, but only up to the ceiling", async () => {
  // Keep-alives every 30 ms; text at 150 ms (past firstTokenMs 60, before ceiling 200).
  const late = provider("a", async (signal, cb) => {
    for (let t = 0; t < 5; t++) {
      await sleep(30, signal);
      cb.onActivity();
    }
    cb.onText("وصل");
    return { provider: "a", model: "a", finish: "stop" };
  });
  const { seen, cb } = collect();
  await runChain([late], request, new AbortController().signal, cb, fast);
  assert.equal(seen.text, "وصل");
  assert.ok(seen.activity >= 5);

  // Keep-alives forever: stops at the ceiling.
  const forever = provider("a", async (signal, cb) => {
    for (;;) {
      await sleep(30, signal);
      cb.onActivity();
    }
  });
  const started = Date.now();
  await assert.rejects(
    runChain(
      [forever],
      request,
      new AbortController().signal,
      collect().cb,
      fast,
    ),
    kindOf("timeout", false),
  );
  const took = Date.now() - started;
  assert.ok(took >= 180 && took < 600, `took ${took} ms`);
});

test("An outer abort stops immediately and never tries the next provider", async () => {
  const controller = new AbortController();
  const a = provider("a", async (signal, cb) => {
    cb.onText("x");
    await sleep(1000, signal);
  });
  const b = provider("b", async () => ({
    provider: "b",
    model: "b",
    finish: "stop",
  }));
  const pending = runChain(
    [a, b],
    request,
    controller.signal,
    collect().cb,
    fast,
  );
  setTimeout(() => controller.abort("stop"), 10);
  await assert.rejects(pending, kindOf("aborted", true));
  assert.equal(b.calls, 0);
  assert.equal(controller.signal.reason, "stop");
});

test("When every provider fails, the most useful reason wins", async () => {
  const fail = (id: string, kind: AiErrorKind) =>
    provider(id, async () => {
      throw new AiError(kind);
    });
  await assert.rejects(
    runChain(
      [fail("a", "server"), fail("b", "quota")],
      request,
      new AbortController().signal,
      collect().cb,
      fast,
    ),
    kindOf("quota"),
  );
  await assert.rejects(
    runChain(
      [fail("a", "empty"), fail("b", "network")],
      request,
      new AbortController().signal,
      collect().cb,
      fast,
    ),
    kindOf("network"),
  );
});
