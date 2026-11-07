// The optional AI card, against the dist-ai build and the local SSE stub
// (scripts/quality/sse-stub.mjs). Nothing here reaches OpenRouter.
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  closeSheet,
  expectAccessible,
  noOverflow,
  ready,
  section,
  seed,
  study,
  tap,
} from "./helpers";
import { STATE_KEY } from "../../src/features/profiles/storage.ts";
import { AI_KEY, AI_URL, STUB_URL } from "./ai-stub";

const GEMMA = "google/gemma-4-31b-it:free";
const CARD = "اسأل الذكاء الاصطناعي";
const CACHE = "nt-ai-cache-v2";
const USAGE = "nt-ai-usage-v1";
const OFF = "nt-ai-off-v1";

type Event = Record<string, unknown>;
type Script = { status?: number; json?: unknown; events?: Event[] };
type Sent = {
  headers: Record<string, string | undefined>;
  body: {
    model: string;
    messages: { role: string; content: string }[];
    [key: string]: unknown;
  };
  closed: boolean;
};

const text = (content: string, model = GEMMA): Event => ({
  data: {
    id: "gen-1",
    model,
    choices: [{ index: 0, delta: { role: "assistant", content } }],
  },
});
const done = (model = GEMMA): Event[] => [
  {
    data: {
      id: "gen-1",
      model,
      choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
    },
  },
  { data: "[DONE]" },
];
const answer = (content: string, model = GEMMA): Script => ({
  events: [text(content, model), ...done(model)],
});

async function queue(request: APIRequestContext, ...scripts: Script[]) {
  await request.post(`${STUB_URL}/__stub/script`, { data: scripts });
}
async function sent(request: APIRequestContext): Promise<Sent[]> {
  return (await request.get(`${STUB_URL}/__stub/log`)).json();
}
async function open(request: APIRequestContext, gate: string) {
  await request.post(`${STUB_URL}/__stub/open?gate=${gate}`);
}

/** The seeded reader on day 10; the feature is on unless told otherwise. */
async function seedAi(
  page: Page,
  options: { off?: boolean; usage?: object; time?: string } = {},
) {
  await seed(page, true, options.time);
  await page.addInitScript(
    ({ off, usage, keys }) => {
      if (sessionStorage.getItem("ai-seeded")) return;
      sessionStorage.setItem("ai-seeded", "1");
      if (off) localStorage.setItem(keys.off, "1");
      if (usage) localStorage.setItem(keys.usage, JSON.stringify(usage));
    },
    {
      off: options.off ?? false,
      usage: options.usage,
      keys: { off: OFF, usage: USAGE },
    },
  );
}
/** Open Matthew 8:15 and its AI card. */
async function openCard(page: Page) {
  await tap(page, 1);
  await expect(section(page, "الكلمات اليونانية")).toBeVisible();
  await section(page, CARD).click();
}
async function start(page: Page) {
  await page.goto("/");
  await ready(page);
  await openCard(page);
}
const chip = (page: Page, label: string) =>
  study(page).getByRole("group").getByRole("button", { name: label });
const answerArea = (page: Page) => study(page).locator(".ai-answer");
const alert = (page: Page) => study(page).getByRole("alert");
const live = (page: Page) => study(page).locator(".ai [role=status]");
const details = (page: Page) =>
  study(page).getByRole("button", { name: "التفاصيل والإعدادات" });
const remaining = (page: Page) =>
  study(page).getByText(/المتبقي على هذا الجهاز اليوم/);
const stored = (page: Page, key: string) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), key);

test.beforeEach(async ({ request, context }) => {
  await request.post(`${STUB_URL}/__stub/reset`);
  await request.post(`${AI_URL}/__test/reset`);
  await context.route(
    (url) => !url.href.startsWith(AI_URL) && !url.href.startsWith(STUB_URL),
    (route) => route.abort(),
  );
  await context.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js*",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.turnstile={render(element,options){queueMicrotask(()=>options.callback(crypto.randomUUID()));return 'widget';},remove(){}};`,
      }),
  );
});

test("lazy challenge, local cache, canonical context and authoritative usage", async ({
  page,
  request,
}) => {
  await seedAi(page, { usage: { date: "2026-10-01", n: 999, a: 999 } });
  let challenges = 0;
  page.on("request", (r) => {
    if (r.url().includes("turnstile/v0/api.js")) challenges++;
  });
  await start(page);
  expect(challenges).toBe(0);
  expect(await sent(request)).toEqual([]);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("إجابة تجريبية.");
  await expect(live(page)).toContainText("اكتملت الإجابة");
  expect(challenges).toBe(1);
  const log = await sent(request);
  expect(log).toHaveLength(1);
  expect(log[0].body.messages[1].content).toContain("8:12–18");
  expect(log[0].headers.authorization).toBe(`Bearer ${AI_KEY}`);
  expect(log[0].headers.cookie).toBeUndefined();
  await details(page).click();
  await expect(remaining(page)).toContainText("٩ من ١٠");
  await chip(page, "اشرح الآية").click();
  expect(await sent(request)).toHaveLength(1);
  expect(await stored(page, CACHE)).not.toBeNull();
});

test("shared cache survives clearing device cache; fresh bypasses it", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("إجابة تجريبية.");
  await page.evaluate((key) => localStorage.removeItem(key), CACHE);
  await page.context().clearCookies();
  await page.reload();
  await ready(page);
  await openCard(page);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("إجابة تجريبية.");
  expect(await sent(request)).toHaveLength(1);
  await details(page).click();
  await expect(remaining(page)).toContainText("١٠ من ١٠");
  await queue(request, answer("شرح آخر"));
  await study(page).getByRole("button", { name: "إجابة أخرى" }).click();
  await expect(answerArea(page)).toContainText("شرح آخر");
  expect(await sent(request)).toHaveLength(2);
});

test("typed questions stay uncached and report links retain their context", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(request, answer("لأن اللمس علامة رحمة."), answer("جواب ثانٍ."));
  await start(page);
  await study(page)
    .getByLabel("اكتب سؤالك عن هذه الآية")
    .fill("لماذا لمس يدها؟");
  await study(page).getByRole("button", { name: "اسأل", exact: true }).click();
  await expect(answerArea(page)).toContainText("لأن اللمس علامة رحمة.");
  const href = await study(page)
    .getByRole("link", { name: "الإبلاغ عن خطأ" })
    .getAttribute("href");
  expect(new URL(href!).searchParams.get("body")).toContain("لماذا لمس يدها؟");
  await study(page).getByRole("button", { name: "إجابة أخرى" }).click();
  await expect(answerArea(page)).toContainText("جواب ثانٍ.");
  expect((await sent(request))[1].body.messages[1].content).toContain(
    "«لماذا لمس يدها؟»",
  );
  expect(await stored(page, CACHE)).toBeNull();
});

test("Stop preserves partial text, restores focus and cancels the upstream", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(request, { events: [text("إجابة جزئية"), { hang: true }] });
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("إجابة جزئية");
  await study(page).getByRole("button", { name: "إيقاف", exact: true }).click();
  await expect(alert(page)).toContainText("أُوقفت الإجابة.");
  await expect(
    alert(page).getByRole("button", { name: "إعادة المحاولة" }),
  ).toBeFocused();
  await expect.poll(async () => (await sent(request))[0]?.closed).toBe(true);
  expect(await stored(page, CACHE)).toBeNull();
});

test("Stop during canonical context loading spends no provider attempt", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await start(page);
  await request.post(`${AI_URL}/__test/hold-assets`);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toHaveAttribute("aria-busy", "true");
  await study(page).getByRole("button", { name: "إيقاف", exact: true }).click();
  await expect(answerArea(page)).toHaveCount(0);
  await expect(chip(page, "اشرح الآية")).toBeFocused();
  expect(await sent(request)).toEqual([]);
});

test("hidden reasoning, counted fallback and partial errors", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(
    request,
    { status: 404, json: { error: { code: 404 } } },
    {
      events: [
        { comment: "working" },
        { gate: "reasoning" },
        text("<think>مخفي</think>**المعنى:** رحمة."),
        ...done(),
      ],
    },
  );
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("النموذج يفكّر");
  await open(request, "reasoning");
  await expect(answerArea(page)).toContainText("رحمة.");
  await expect(answerArea(page)).not.toContainText("مخفي");
  expect(await sent(request)).toHaveLength(2);
  await queue(request, {
    events: [text("جزء من الشرح"), { data: { error: { code: 500 } } }],
  });
  await chip(page, "معاني الكلمات").click();
  await expect(alert(page)).toContainText("انقطعت الإجابة");
  expect(await sent(request)).toHaveLength(3);
});

test("runtime off preserves device cached answers and the device off switch preserves reading data", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("إجابة تجريبية.");
  await request.post(`${AI_URL}/__test/reset?disabled`);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("إجابة تجريبية.");
  await chip(page, "معاني الكلمات").click();
  await expect(alert(page)).toContainText("الخدمة غير متاحة حاليًا");
  const progress = await page.evaluate(
    (key) => localStorage.getItem(key),
    STATE_KEY,
  );
  await details(page).click();
  await study(page)
    .getByRole("button", { name: "إيقاف الميزة ومسح بياناتها" })
    .click();
  await expect(
    study(page).getByRole("button", { name: "تشغيل الميزة" }),
  ).toBeFocused();
  expect(await stored(page, CACHE)).toBeNull();
  expect(await stored(page, OFF)).toBe(1);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STATE_KEY),
  ).toBe(progress);
});

test("AI states fit 320–430px, both themes, large Arabic text, reduced motion and accessibility", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await page.addInitScript(() => localStorage.setItem("word-font", "38"));
  await start(page);
  for (const width of [320, 430])
    for (const dark of [false, true]) {
      await page.setViewportSize({ width, height: 740 });
      await page.evaluate((dark) => {
        document.documentElement.dataset.theme = dark ? "dark" : "light";
      }, dark);
      await noOverflow(page);
      await expectAccessible(page, { include: "dialog[open]", wcag: true });
    }
  await queue(request, {
    events: [
      { comment: "working" },
      { gate: "layout" },
      text("**المعنى:** نص عربي واضح.\n\n- نقطة أولى\n- نقطة ثانية"),
      ...done(),
    ],
  });
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page).locator(".ai-progress")).toBeVisible();
  await expectAccessible(page, { include: "dialog[open]", wcag: true });
  await open(request, "layout");
  await expect(answerArea(page).locator("li")).toHaveCount(2);
  await noOverflow(page);
  await expectAccessible(page, { include: "dialog[open]", wcag: true });
  await page.screenshot({ path: "artifacts/ai-worker-mobile.png" });
  await closeSheet(page);
});

test("client bundles omit all credentials and server prompts, disabled builds omit the feature", () => {
  const files = (dir: string) => {
    const path = fileURLToPath(
      new URL(`../../${dir}/assets/`, import.meta.url),
    );
    return readdirSync(path).map((name) => ({
      name,
      text: readFileSync(path + name, "utf8"),
    }));
  };
  for (const f of [...files("dist"), ...files("dist-ai")])
    expect(f.text).not.toMatch(
      /sk-or-v1-|gateway-test-token|dummy-gateway-token|أنت مساعد لدراسة الكتاب المقدس|gateway\.ai\.cloudflare/,
    );
  expect(files("dist").some((f) => /^(AiPanel|run)-/.test(f.name))).toBe(false);
});
