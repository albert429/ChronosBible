import { AiError } from "../src/features/ai/domain/types.ts";
import type { Env } from "./env.ts";
import { bytes } from "./http.ts";

const COOKIE = "__Host-chronos-ai";
const LIFETIME = 30 * 86400_000;
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export async function digest(text: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}
export async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}
export async function identity(request: Request, env: Env, now: number) {
  const cookies = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(COOKIE + "="));
  let value: string | undefined = cookies[0]?.slice(COOKIE.length + 1);
  if (cookies.length > 1) throw new AiError("auth");
  if (value) {
    const match = /^([a-f0-9-]{36})\.(\d{13})\.([a-f0-9]{64})$/.exec(value);
    if (!match || Number(match[2]) > now + LIFETIME + 60000)
      throw new AiError("auth");
    const expected = await hmac(
      env.AI_COOKIE_SECRET,
      `${match[1]}.${match[2]}`,
    );
    let difference = 0;
    for (let i = 0; i < 64; i++)
      difference |= expected.charCodeAt(i) ^ match[3].charCodeAt(i);
    if (difference) throw new AiError("auth");
    if (Number(match[2]) <= now) value = undefined;
  }
  let cookie: string | undefined;
  if (!value) {
    const payload = `${crypto.randomUUID()}.${now + LIFETIME}`;
    value = `${payload}.${await hmac(env.AI_COOKIE_SECRET, payload)}`;
    cookie = `${COOKIE}=${value}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Strict`;
  }
  return { id: value.split(".")[0], cookie };
}

export async function verifyTurnstile(
  token: string,
  env: Env,
  signal: AbortSignal,
) {
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    },
  );
  const value = JSON.parse(
    new TextDecoder().decode(await bytes(response.body, 8192, signal)),
  );
  const age = Date.now() - Date.parse(value.challenge_ts);
  if (
    !response.ok ||
    value.success !== true ||
    value.hostname !== new URL(env.AI_ORIGIN).hostname ||
    value.action !== "ai_answer" ||
    !Number.isFinite(age) ||
    age < -60000 ||
    age > 300000
  )
    throw new AiError("challenge");
}
