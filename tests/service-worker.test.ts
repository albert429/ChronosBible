// The built /sw.js, run against a stand-in worker scope: what it keeps across
// builds, when it takes over, and which requests it leaves to the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import type { Plugin } from "vite";
import { serviceWorker } from "../scripts/build/service-worker.ts";
import { DATA_CACHE, SAVE_HEADER } from "../src/features/offline/rules.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ORIGIN = "https://chronosbible.com";
const VERSIONS = {
  bible: "bible-new",
  readings: "read-1",
  chronology: "chrono-1",
  study: "study-1",
};

async function buildWorker() {
  const outDir = mkdtempSync(join(tmpdir(), "sw contract "));
  try {
    writeFileSync(join(outDir, "index.html"), "<html>app</html>");
    const plugin = serviceWorker(VERSIONS) as Plugin & {
      configResolved: (config: unknown) => void;
      writeBundle: (options: unknown, bundle: unknown) => Promise<void>;
    };
    plugin.configResolved({ root: ROOT, build: { outDir } });
    await plugin.writeBundle(
      {},
      {
        "index.html": { type: "asset", source: "<html>app</html>" },
        "assets/index-AbCdEf12.js": { type: "chunk" },
      },
    );
    return readFileSync(join(outDir, "sw.js"), "utf8");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
const code = await buildWorker();

type Handler = (event: unknown) => void;
type FakeRequest = {
  url: string;
  method: string;
  mode: string;
  headers: Headers;
};
const key = (request: string | FakeRequest) =>
  new URL(typeof request === "string" ? request : request.url, ORIGIN).href;

/** A worker scope with its own cache storage and network. */
function startWorker(saved: Record<string, string[]> = {}) {
  const stores = new Map<string, Map<string, Response>>();
  const store = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name)!;
  };
  for (const [name, urls] of Object.entries(saved))
    for (const url of urls) store(name).set(key(url), new Response(url));
  const handlers = new Map<string, Handler>();
  const network: string[] = [];
  const calls: string[] = [];
  const fetch = async (request: string | FakeRequest) => {
    network.push(key(request));
    return new Response(`network ${key(request)}`);
  };
  const cacheApi = (name: string) => ({
    addAll: async (urls: string[]) => {
      for (const url of urls) store(name).set(key(url), await fetch(url));
    },
    put: async (request: string | FakeRequest, response: Response) => {
      store(name).set(key(request), response);
    },
    keys: async () => [...store(name).keys()].map((url) => ({ url })),
    delete: async (request: { url: string }) => store(name).delete(request.url),
  });
  const scope = {
    addEventListener: (type: string, handler: Handler) =>
      handlers.set(type, handler),
    skipWaiting: async () => void calls.push("skipWaiting"),
    clients: { claim: async () => void calls.push("claim") },
    location: { origin: ORIGIN },
  };
  vm.runInContext(
    code,
    vm.createContext({
      self: scope,
      URL,
      fetch,
      caches: {
        open: async (name: string) => cacheApi(name),
        keys: async () => [...stores.keys()],
        delete: async (name: string) => stores.delete(name),
        match: async (
          request: string | FakeRequest,
          options: { cacheName: string; ignoreVary?: boolean },
        ) => {
          assert.equal(options.ignoreVary, true);
          return stores.get(options.cacheName)?.get(key(request))?.clone();
        },
      },
    }),
  );
  /** Dispatch a lifecycle event and wait for the work it extends to. */
  async function lifecycle(type: string, data?: unknown) {
    const work: Promise<unknown>[] = [];
    handlers.get(type)!({
      data,
      waitUntil: (p: Promise<unknown>) => work.push(p),
    });
    await Promise.all(work);
  }
  /** A request through the worker; undefined when it is left alone. */
  async function request(
    path: string,
    { method = "GET", mode = "cors", headers = new Headers() } = {},
  ) {
    let answer: Promise<Response> | undefined;
    const work: Promise<unknown>[] = [];
    handlers.get("fetch")!({
      request: { url: new URL(path, ORIGIN).href, method, mode, headers },
      respondWith: (response: Promise<Response>) => (answer = response),
      waitUntil: (p: Promise<unknown>) => work.push(p),
    });
    const response = await answer;
    await Promise.all(work);
    return response && (await response.text());
  }
  return { stores, network, calls, lifecycle, request };
}

test("a new build installs its shell and waits for the reader to accept it", async () => {
  const worker = startWorker();
  await worker.lifecycle("install");
  const shells = [...worker.stores.keys()].filter((name) =>
    name.startsWith("chronos-shell-"),
  );
  assert.equal(shells.length, 1);
  // The page, its hashed files, the manifest and the icons in public/.
  const shell = [...worker.stores.get(shells[0])!.keys()];
  for (const path of ["/", "/assets/index-AbCdEf12.js", "/manifest.json"])
    assert.ok(shell.includes(key(path)), path);
  assert.ok(
    shell.every((url) =>
      /^\/(?:|assets\/index-AbCdEf12\.js|manifest\.json|icons\/[^/]+)$/.test(
        new URL(url).pathname,
      ),
    ),
  );
  assert.deepEqual(worker.calls, []);
  await worker.lifecycle("message", "something else");
  assert.deepEqual(worker.calls, []);
  await worker.lifecycle("message", "update");
  assert.deepEqual(worker.calls, ["skipWaiting"]);
});

test("taking over keeps saved data whose folder is unchanged, across builds", async () => {
  const kept = [
    "/bible/GEN/1.json?v=bible-new",
    "/readings/1.json?v=read-1",
    "/chronology/OT.json?v=chrono-1",
    "/study/v2/GEN/1/1-31.words.json.gz?v=study-1",
  ];
  const worker = startWorker({
    "chronos-shell-older": ["/", "/assets/index-old.js"],
    [DATA_CACHE]: [...kept, "/bible/GEN/2.json?v=bible-old"],
  });
  await worker.lifecycle("install");
  await worker.lifecycle("activate");
  assert.equal(worker.stores.has("chronos-shell-older"), false);
  assert.deepEqual(
    [...worker.stores.get(DATA_CACHE)!.keys()],
    kept.map((path) => key(path)),
  );
  assert.deepEqual(worker.calls, ["claim"]);
});

test("audio, AI, saves and other sites go to the network untouched", async () => {
  const worker = startWorker();
  await worker.lifecycle("install");
  worker.network.length = 0;
  for (const [path, init] of [
    ["/audio/1.json", {}],
    ["/audio/chapters/GEN/1.json", {}],
    ["https://audio.chronosbible.com/days/001-abc.m4a", {}],
    ["https://openrouter.ai/api/v1/chat/completions", { method: "POST" }],
    ["/bible/GEN/1.json?v=bible-new", { method: "POST" }],
    [
      "/bible/GEN/1.json?v=bible-new",
      { headers: new Headers({ [SAVE_HEADER]: "1" }) },
    ],
    ["/bible/GEN/1.json", {}],
    ["/licenses/study-data.txt", { mode: "navigate" }],
  ] as const)
    assert.equal(await worker.request(path, init), undefined, path);
  // Left alone means no request from the worker either.
  assert.deepEqual(worker.network, []);
  assert.deepEqual([...(worker.stores.get(DATA_CACHE)?.keys() ?? [])], []);
});

test("pages are this build's app; versioned data, gzip included, is kept on first use", async () => {
  const worker = startWorker();
  await worker.lifecycle("install");
  worker.network.length = 0;
  assert.equal(
    await worker.request("/?mode=bible&book=GEN&chapter=1", {
      mode: "navigate",
    }),
    `network ${key("/")}`,
  );
  const words = "/study/v2/GEN/1/1-31.words.json.gz?v=study-1";
  assert.equal(await worker.request(words), `network ${key(words)}`);
  assert.equal(await worker.request(words), `network ${key(words)}`);
  // The second answer came from the data cache: one network request.
  assert.deepEqual(worker.network, [key(words)]);
  assert.deepEqual([...worker.stores.get(DATA_CACHE)!.keys()], [key(words)]);
});
