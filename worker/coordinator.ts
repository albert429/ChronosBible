import { MODELS } from "./models.ts";
import {
  AiError,
  type AiEvent,
  type AiMeta,
} from "../src/features/ai/domain/types.ts";
import { cleanAnswer, clip, MAX_TEXT } from "../src/features/ai/domain/text.ts";
import { Assets } from "./context.ts";
import { configured, OVERALL_MS, type Env } from "./env.ts";
import { failure, HEADERS, jsonBody } from "./http.ts";
import { digest, hmac, identity, verifyTurnstile } from "./identity.ts";
import { dayAt, Ledger } from "./storage.ts";
import { validate } from "./validation.ts";
import { buildPrompt } from "./prompt.ts";
import { runChain } from "./chain.ts";
import { provider } from "./provider.ts";

const encoder = new TextEncoder();
const encode = (e: AiEvent) =>
  encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);

export class AiCoordinator {
  private active = new Map<string, AbortController>();
  private state: DurableObjectState;
  private env: Env;
  private assets: Assets;
  private ledger: Ledger;
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.assets = new Assets(env.ASSETS);
    this.ledger = new Ledger(state.storage, env.AI_ENVIRONMENT);
  }
  async alarm() {
    this.ledger.cleanup(Date.now());
    await this.state.storage.setAlarm(Date.now() + 3600000);
  }
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/cancel") {
      this.active
        .get(request.headers.get("x-ai-request-id") ?? "")
        ?.abort("disconnect");
      return new Response(null, { status: 204 });
    }
    const requestId =
        request.headers.get("x-ai-request-id") ?? crypto.randomUUID(),
      started = Date.now();
    const controller = new AbortController();
    const deadline = AbortSignal.timeout(OVERALL_MS);
    this.active.set(requestId, controller);
    let cookie: string | undefined;
    try {
      if (!configured(this.env)) throw new AiError("disabled");
      const now = Date.now();
      const ip = await hmac(
        this.env.AI_COOKIE_SECRET,
        `ip:${dayAt(now, "UTC")}:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`,
      );
      this.ledger.burst(ip, now);
      if ((await this.state.storage.getAlarm()) === null)
        await this.state.storage.setAlarm(now + 3600000);
      const browser = await identity(request, this.env, now);
      cookie = browser.cookie;
      // Pseudonyms: never persist the cookie ID or raw address.
      const device = await hmac(
        this.env.AI_COOKIE_SECRET,
        `device:${browser.id}`,
      );
      const signal = AbortSignal.any([
        request.signal,
        controller.signal,
        deadline,
      ]);
      const revision = await this.assets.revision(signal);
      const quota = () =>
        this.ledger.status(device, Date.now(), revision, true);
      const headers = {
        ...HEADERS,
        ...(cookie ? { "Set-Cookie": cookie } : {}),
      };
      if (request.method === "GET") {
        this.active.delete(requestId);
        return Response.json(quota(), { headers });
      }
      const input = validate(await jsonBody(request, signal));
      await verifyTurnstile(input.turnstileToken, this.env, signal);
      this.ledger.token(await digest(input.turnstileToken), Date.now());
      const key =
        input.chip === "ask"
          ? null
          : `${input.verseId}|${input.chip}|${revision}`;
      const cached =
        key && !input.fresh ? this.ledger.cached(key, Date.now()) : undefined;
      if (cached) {
        this.active.delete(requestId);
        const events: AiEvent[] = [
          {
            event: "meta",
            data: { model: cached.model, cached: true, requestId },
          },
          { event: "delta", data: { text: cached.text } },
          { event: "quota", data: quota() },
          {
            event: "done",
            data: {
              provider: "openrouter",
              model: cached.model,
              finish: "stop",
            },
          },
        ];
        console.log(
          JSON.stringify({ requestId, ms: Date.now() - started, cache: "hit" }),
        );
        return new Response(new Blob(events.map(encode)), {
          headers: {
            ...headers,
            "Content-Type": "text/event-stream; charset=utf-8",
          },
        });
      }
      this.ledger.reserve(requestId, device, key, Date.now());
      const forward = () => controller.abort(signal.reason);
      signal.addEventListener("abort", forward, { once: true });
      if (signal.aborted) forward();
      let ended = false;
      const body = new ReadableStream<Uint8Array>({
        start: (stream) => {
          const send = (event: AiEvent) => {
            if (!ended) stream.enqueue(encode(event));
          };
          send({ event: "meta", data: { cached: false, requestId } });
          // A heartbeat also detects disconnected streaming clients while upstream is silent.
          const heartbeat = setInterval(() => {
            try {
              send({ event: "activity", data: {} });
            } catch {
              controller.abort("disconnect");
            }
          }, 1000);
          const generate = async () => {
            let raw = "",
              shown = "",
              model = "",
              counted = false,
              truncated = false;
            let code = "done";
            try {
              const { material, complete } = await this.assets.material(
                input.verseId,
                input.chip,
                controller.signal,
              );
              const prompt = buildPrompt(input.chip, material, input.question);
              let meta: AiMeta;
              try {
                meta = await runChain(
                  MODELS.map((m) =>
                    provider(this.env, m, () => {
                      this.ledger.attempt(requestId, Date.now());
                      send({ event: "quota", data: quota() });
                    }),
                  ),
                  prompt,
                  controller.signal,
                  {
                    onMeta: (name) => {
                      model = name.slice(0, 100);
                      send({
                        event: "meta",
                        data: { model, cached: false, requestId },
                      });
                    },
                    onActivity: () => send({ event: "activity", data: {} }),
                    onText: (delta) => {
                      raw += delta;
                      if (raw.length > 65536)
                        throw new AiError("server", counted);
                      // Do not leak an opening/closing reasoning tag split across chunks.
                      const safe = raw.replace(
                        /<(?:\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?)?$/i,
                        "",
                      );
                      const visible = cleanAnswer(safe);
                      if (!visible) return;
                      if (!counted) {
                        this.ledger.answered(requestId, Date.now());
                        counted = true;
                        send({ event: "quota", data: quota() });
                      }
                      shown = clip(visible, MAX_TEXT);
                      send({ event: "delta", data: { text: shown } });
                      if (visible.length > MAX_TEXT) {
                        truncated = true;
                        controller.abort("truncated");
                      }
                    },
                  },
                );
              } catch (error) {
                if (!truncated) throw error;
                meta = { provider: "openrouter", model, finish: "length" };
              }
              if (!shown) throw new AiError("empty");
              if (controller.signal.aborted && !truncated)
                throw new AiError("aborted", counted);
              if (key && complete && !truncated && meta.finish === "stop")
                this.ledger.save(key, shown, meta.model, Date.now());
              send({ event: "quota", data: quota() });
              send({ event: "done", data: meta });
            } catch (error) {
              const e =
                error instanceof AiError
                  ? error
                  : new AiError(
                      controller.signal.aborted ? "aborted" : "server",
                    );
              code = deadline.aborted ? "timeout" : e.kind;
              send({
                event: "error",
                data: {
                  kind: code as AiError["kind"],
                  retryAt: e.retryAt,
                  model,
                },
              });
            } finally {
              clearInterval(heartbeat);
              this.active.delete(requestId);
              this.ledger.release(requestId);
              signal.removeEventListener("abort", forward);
              if (!ended) {
                ended = true;
                stream.close();
              }
              console.log(
                JSON.stringify({
                  requestId,
                  ms: Date.now() - started,
                  cache: "miss",
                  code,
                }),
              );
            }
          };
          this.state.waitUntil(generate());
        },
        cancel: () => {
          ended = true;
          controller.abort("disconnect");
        },
      });
      return new Response(body, {
        headers: {
          ...headers,
          "Content-Type": "text/event-stream; charset=utf-8",
        },
      });
    } catch (error) {
      this.active.delete(requestId);
      const response = failure(error);
      if (cookie) response.headers.set("Set-Cookie", cookie);
      console.log(
        JSON.stringify({
          requestId,
          ms: Date.now() - started,
          code: error instanceof AiError ? error.kind : "storage",
        }),
      );
      return response;
    }
  }
}
