// A scriptable stand-in for OpenRouter's chat-completions endpoint, used only
// by the browser tests (tests/browser/ai.spec.ts) against the dist-ai build.
// Tests queue responses through the /__stub/* control endpoints; each
// completion request takes the next one (or a short default answer).
//
// A response is { status?, json?, events? }. Non-200 responses send `json`.
// Events are sent in order:
//   { data }        an SSE data line (an object, or the string "[DONE]")
//   { comment }     an SSE comment, like OpenRouter's keep-alives
//   { delay }       wait that many real milliseconds
//   { gate }        wait until the test opens that gate
//   { keepAlive }   send a keep-alive comment every N ms until the client leaves
//   { hang: true }  keep the connection open until the client leaves
import { createServer } from "node:http";

const port = Number(process.env.SSE_STUB_PORT || 4175);
const MODEL = "google/gemma-4-31b-it:free";
const fallback = () => ({
  events: [
    {
      data: {
        model: MODEL,
        choices: [{ index: 0, delta: { content: "إجابة تجريبية." } }],
      },
    },
    { data: { model: MODEL, choices: [{ index: 0, finish_reason: "stop" }] } },
    { data: "[DONE]" },
  ],
});

let queue = [];
let log = [];
let gates = new Map();

function gate(name) {
  let entry = gates.get(name);
  if (!entry) {
    let open;
    entry = { opened: false, promise: new Promise((r) => (open = r)) };
    entry.open = () => {
      entry.opened = true;
      open();
    };
    gates.set(name, entry);
  }
  return entry;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function readBody(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text;
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function complete(req, res) {
  const text = await readBody(req);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const keep = [
    "authorization",
    "content-type",
    "http-referer",
    "x-openrouter-title",
    "x-openrouter-app-visibility",
    "cookie",
  ];
  // `closed` records a client that left before the response ended.
  const entry = {
    headers: Object.fromEntries(keep.map((name) => [name, req.headers[name]])),
    body,
    closed: false,
  };
  log.push(entry);
  const script = queue.shift() ?? fallback();
  const status = script.status ?? 200;
  if (status !== 200) return json(res, status, script.json ?? {}, cors);

  let closed = false;
  let ended = false;
  res.on("close", () => {
    closed = true;
    if (!ended) entry.closed = true;
  });
  res.writeHead(200, {
    ...cors,
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const untilClosed = () =>
    new Promise((resolve) => {
      if (closed) resolve();
      else res.on("close", resolve);
    });
  for (const event of script.events ?? []) {
    if (closed) return;
    if ("data" in event)
      res.write(
        `data: ${typeof event.data === "string" ? event.data : JSON.stringify(event.data)}\n\n`,
      );
    else if ("comment" in event) res.write(`: ${event.comment}\n\n`);
    else if ("delay" in event) await wait(event.delay);
    else if ("gate" in event)
      await Promise.race([gate(event.gate).promise, untilClosed()]);
    else if ("keepAlive" in event)
      while (!closed) {
        res.write(": OPENROUTER PROCESSING\n\n");
        await wait(event.keepAlive);
      }
    else if (event.hang) await untilClosed();
  }
  if (closed) return;
  ended = true;
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method === "OPTIONS") {
      // Authorization is never covered by a wildcard, so echo the request.
      res.writeHead(204, {
        ...cors,
        "Access-Control-Allow-Headers":
          req.headers["access-control-request-headers"] ?? "",
      });
      return res.end();
    }
    if (url.pathname === "/api/v1/chat/completions" && req.method === "POST")
      return await complete(req, res);
    if (url.pathname === "/__stub/health") return json(res, 200, { ok: true });
    if (url.pathname === "/__stub/log") return json(res, 200, log);
    if (url.pathname === "/__stub/reset" && req.method === "POST") {
      for (const entry of gates.values()) entry.open();
      queue = [];
      log = [];
      gates = new Map();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/__stub/script" && req.method === "POST") {
      const scripts = JSON.parse(await readBody(req));
      queue.push(...(Array.isArray(scripts) ? scripts : [scripts]));
      return json(res, 200, { queued: queue.length });
    }
    if (url.pathname === "/__stub/open" && req.method === "POST") {
      gate(url.searchParams.get("gate") ?? "").open();
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    if (!res.headersSent) json(res, 500, { error: String(error) });
    else res.end();
  }
});

server.listen(port, "127.0.0.1", () =>
  console.log(`SSE stub on http://127.0.0.1:${port}`),
);
