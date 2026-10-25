// The optional AI card, against the dist-ai build and the local SSE stub
// (scripts/sse-stub.mjs). Nothing here reaches OpenRouter.
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
import { STATE_KEY } from "../../src/plan/progress.ts";
import { AI_KEY, AI_URL, STUB_URL } from "./ai-stub";

const GEMMA = "google/gemma-4-31b-it:free";
const CARD = "اسأل الذكاء الاصطناعي";
const CACHE = "nt-ai-cache-v1";
const USAGE = "nt-ai-usage-v1";
const OFF = "nt-ai-off-v1";

type Event = Record<string, unknown>;
type Script = { status?: number; json?: unknown; events?: Event[] };
type Sent = {
  headers: Record<string, string | undefined>;
  body: {
    models: string[];
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
  // Only the AI build and the stub are reachable.
  await context.route(
    (url) => !url.href.startsWith(AI_URL) && !url.href.startsWith(STUB_URL),
    (route) => route.abort(),
  );
});

test("the AI card opens on its chips, keeps details in one link and sends nothing until a chip is tapped", async ({
  page,
  request,
}) => {
  await seedAi(page);
  const chunks: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (/\/assets\/(AiPanel|run)-/.test(path)) chunks.push(path.split("/")[2]);
  });
  await page.goto("/");
  await ready(page);
  await tap(page, 1);
  await expect(section(page, "الكلمات اليونانية")).toBeVisible();
  await expect(study(page).locator(".study-section-title")).toHaveText([
    "ترجمات أخرى",
    CARD,
    "الكلمات اليونانية",
  ]);
  await expect(section(page, CARD)).toHaveAttribute("aria-expanded", "false");
  await expect(section(page, CARD)).toHaveAccessibleDescription(
    "شرح الآية وخلفيتها ومعاني كلماتها، أو سؤالك",
  );
  expect(chunks).toEqual([]);

  await section(page, CARD).click();
  await expect(chip(page, "اشرح الآية")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  // The notes, warnings and the off switch sit behind one small link.
  await expect(details(page)).toHaveAttribute("aria-expanded", "false");
  await expect(study(page).getByText("لا تكتب معلومات شخصية.")).toBeHidden();
  await details(page).click();
  await expect(details(page)).toHaveAttribute("aria-expanded", "true");
  const notes = study(page).locator(".ai-details");
  await expect(notes).toContainText("لا تكتب معلومات شخصية.");
  await expect(notes).toContainText("OpenRouter");
  await expect(notes).toContainText("دون اسمك أو تقدّمك");
  await expect(remaining(page)).toContainText("١٠ من ١٠");
  await expect(
    notes.getByRole("button", { name: "إيقاف الميزة ومسح بياناتها" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(chunks.every((c) => c.startsWith("AiPanel-"))).toBe(true);
  expect(await sent(request)).toEqual([]);

  await closeSheet(page);
  await openCard(page);
  await expect(chip(page, "اشرح الآية")).toBeVisible();
  expect(await sent(request)).toEqual([]);
});

test("an answer streams in, then the card reports it once and counts it", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(request, {
    events: [
      { comment: "OPENROUTER PROCESSING" },
      { gate: "first" },
      text("**المعنى:** "),
      { gate: "rest" },
      text("لمس يسوع يدها فشُفيت.\n\n- قامت وخدمتهم\n- شفاء كامل"),
      ...done(),
    ],
  });
  await start(page);
  await chip(page, "اشرح الآية").click();

  await expect(chip(page, "اشرح الآية")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const label of ["اشرح الآية", "معاني الكلمات", "الخلفية والسياق"])
    await expect(chip(page, label)).toHaveAttribute("aria-disabled", "true");
  await expect(answerArea(page)).toHaveAttribute("aria-busy", "true");
  await expect(answerArea(page).locator(".ai-progress")).toHaveText(
    "النموذج يفكّر…",
  );
  await expect(live(page)).toHaveText("جارٍ إعداد الإجابة…");
  // The answer area sits between the chips and the question box.
  const order = await study(page)
    .locator(".ai > .ai-chips, .ai > .ai-answer, .ai > .ai-ask")
    .evaluateAll((els) => els.map((el) => el.className));
  expect(order).toEqual(["ai-chips", "ai-answer", "ai-ask"]);
  await expect(
    study(page).getByRole("button", { name: "إيقاف", exact: true }),
  ).toBeVisible();

  await open(request, "first");
  await expect(answerArea(page).locator("strong")).toHaveText("المعنى:");
  await expect(answerArea(page).locator(".ai-progress")).toHaveCount(0);
  await expect(answerArea(page)).toHaveAttribute("aria-busy", "true");
  await expect(remaining(page)).toContainText("٩ من ١٠");

  // A keyboard reader waiting on «إيقاف» keeps a focused control at the end.
  await study(page).getByRole("button", { name: "إيقاف", exact: true }).focus();
  await open(request, "rest");
  await expect(answerArea(page).locator("li")).toHaveText([
    "قامت وخدمتهم",
    "شفاء كامل",
  ]);
  await expect(answerArea(page)).toHaveAttribute("aria-busy", "false");
  await expect(live(page)).toHaveText("اكتملت الإجابة: اشرح الآية");
  await expect(
    study(page).getByRole("button", { name: "إجابة أخرى" }),
  ).toBeFocused();
  await expect(study(page).locator(".ai-footer")).toContainText(
    "إجابة مولَّدة بالذكاء الاصطناعي، قد تحتوي أخطاء",
  );
  await expect(study(page).locator(".ai-footer bdi")).toHaveText(
    "google/gemma-4-31b-it",
  );
  await expect(chip(page, "معاني الكلمات")).not.toHaveAttribute(
    "aria-disabled",
  );
  await expect(
    study(page).getByRole("button", { name: "إيقاف", exact: true }),
  ).toHaveCount(0);
  expect(await stored(page, USAGE)).toEqual({ date: "2026-10-01", n: 1, a: 1 });

  const [request1] = await sent(request);
  expect(request1.headers).toMatchObject({
    authorization: `Bearer ${AI_KEY}`,
    "content-type": "application/json",
    "http-referer": `${AI_URL}/`,
    "x-openrouter-title": "Bible150",
    "x-openrouter-app-visibility": "hidden",
  });
  expect(request1.headers.cookie).toBeUndefined();
  expect(Object.keys(request1.body).sort()).toEqual([
    "max_tokens",
    "messages",
    "models",
    "reasoning",
    "stream",
    "temperature",
  ]);
  expect(request1.body.models).toEqual([
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "openrouter/free",
  ]);
  const [system, user] = request1.body.messages;
  expect(system.role).toBe("system");
  expect(user.role).toBe("user");
  expect(user.content).toMatch(/^المرجع: متى 8:15\n/);
  expect(user.content).toContain("الترجمة الإنجليزية (KJV):\nAnd he touched");
  expect(user.content).toContain("ترجمة كتاب الحياة:");
  // Nothing personal: no name, dates, plan day or progress.
  expect(JSON.stringify(request1.body)).not.toMatch(
    /ميخائيل|reader-one|2026|اليوم ١٠/,
  );
});

test("a cached answer comes back without a request; «إجابة أخرى» asks again", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(request, answer("الشرح الأول."), answer("الشرح الثاني."));
  await start(page);
  await chip(page, "الخلفية والسياق").click();
  await expect(answerArea(page)).toContainText("الشرح الأول.");
  await expect(answerArea(page)).toHaveAttribute("aria-busy", "false");

  await closeSheet(page);
  await openCard(page);
  await chip(page, "الخلفية والسياق").click();
  await expect(answerArea(page)).toContainText("الشرح الأول.");
  await expect(live(page)).toHaveText("اكتملت الإجابة: الخلفية والسياق");
  await page.reload();
  await ready(page);
  await openCard(page);
  await chip(page, "الخلفية والسياق").click();
  await expect(answerArea(page)).toContainText("الشرح الأول.");
  await expect(study(page).locator(".ai-footer bdi")).toHaveText(
    "google/gemma-4-31b-it",
  );
  expect(await sent(request)).toHaveLength(1);
  expect(await stored(page, USAGE)).toMatchObject({ n: 1, a: 1 });

  await study(page).getByRole("button", { name: "إجابة أخرى" }).click();
  await expect(answerArea(page)).toContainText("الشرح الثاني.");
  await expect(answerArea(page)).not.toContainText("الشرح الأول.");
  expect(await sent(request)).toHaveLength(2);
  const cache = await stored(page, CACHE);
  expect(cache.e).toHaveLength(1);
  expect(cache.e[0][1]).toBe("الشرح الثاني.");
});

test("the device answer and attempt caps stop requests until the Cairo day changes", async ({
  page,
  request,
}) => {
  await seedAi(page, { usage: { date: "2026-10-01", n: 10, a: 10 } });
  await start(page);
  await expect(remaining(page)).toContainText("٠ من ١٠");
  await chip(page, "اشرح الآية").click();
  await expect(alert(page)).toHaveText(
    "وصلت للحد اليومي للإجابات على هذا الجهاز (١٠). حاول غدًا.",
  );
  await expect(alert(page).getByRole("button")).toHaveCount(0);

  await page.evaluate(
    ([key]) =>
      localStorage.setItem(
        key,
        JSON.stringify({ date: "2026-10-01", n: 2, a: 20 }),
      ),
    [USAGE],
  );
  await chip(page, "معاني الكلمات").click();
  await expect(alert(page)).toHaveText(
    "تعذّرت محاولات كثيرة اليوم على هذا الجهاز. حاول غدًا.",
  );
  expect(await sent(request)).toEqual([]);
});

test("yesterday's counts do not apply after midnight in Cairo", async ({
  page,
  request,
}) => {
  // 22:30 UTC on 30 September is already 1 October in Cairo.
  await seedAi(page, {
    time: "2026-09-30T22:30:00Z",
    usage: { date: "2026-09-30", n: 10, a: 20 },
  });
  await start(page);
  await expect(remaining(page)).toContainText("١٠ من ١٠");
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("إجابة تجريبية.");
  expect(await stored(page, USAGE)).toEqual({ date: "2026-10-01", n: 1, a: 1 });
  expect(await sent(request)).toHaveLength(1);
});

test("an unavailable model list falls through to the free router once", async ({
  page,
  request,
}) => {
  await seedAi(page);
  const routed = "mistralai/mistral-small-3.2-24b-instruct:free";
  await queue(
    request,
    {
      status: 404,
      json: {
        error: {
          code: 404,
          message: "No endpoints found matching your data policy",
        },
      },
    },
    answer("إجابة من نموذج آخر.", routed),
  );
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("إجابة من نموذج آخر.");
  await expect(study(page).locator(".ai-footer bdi")).toHaveText(
    "mistralai/mistral-small-3.2-24b-instruct",
  );
  const log = await sent(request);
  expect(log.map((r) => r.body.models)).toEqual([
    [
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "openrouter/free",
    ],
    ["openrouter/free"],
  ]);
  expect(await stored(page, USAGE)).toMatchObject({ n: 1, a: 1 });
});

test("a rate limit cools down; the daily quota stops requests for the session", async ({
  page,
  request,
}) => {
  await seedAi(page);
  const reset = Date.parse("2026-10-01T12:00:45Z");
  const limited = (message: string) => ({
    status: 429,
    json: {
      error: {
        code: 429,
        message,
        metadata: {
          headers: {
            "X-RateLimit-Limit": "20",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(reset),
          },
          provider_name: null,
        },
      },
    },
  });
  await queue(
    request,
    limited("Rate limit exceeded: free-models-per-min. "),
    limited(
      "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
    ),
  );
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(alert(page)).toContainText("الخدمة مشغولة الآن. حاول بعد قليل.");
  const retry = alert(page).getByRole("button", { name: "إعادة المحاولة" });
  await expect(retry).toHaveAttribute("aria-disabled", "true");
  await retry.click({ force: true });
  await chip(page, "معاني الكلمات").click();
  await expect(alert(page)).toContainText("الخدمة مشغولة الآن.");
  expect(await sent(request)).toHaveLength(1);

  // The reset time from the 429 body (45 s) beats the 30 s default.
  await page.clock.runFor(31000);
  await expect(
    alert(page).getByRole("button", { name: "إعادة المحاولة" }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.clock.runFor(15000);
  await expect(
    alert(page).getByRole("button", { name: "إعادة المحاولة" }),
  ).not.toHaveAttribute("aria-disabled");
  await alert(page).getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(alert(page)).toHaveText(
    "انتهت حصة الخدمة المشتركة اليوم. حاول غدًا.",
  );
  await expect(alert(page).getByRole("button")).toHaveCount(0);
  expect(await sent(request)).toHaveLength(2);

  await closeSheet(page);
  await openCard(page);
  await chip(page, "الخلفية والسياق").click();
  await expect(alert(page)).toHaveText(
    "انتهت حصة الخدمة المشتركة اليوم. حاول غدًا.",
  );
  expect(await sent(request)).toHaveLength(2);
  expect(await stored(page, USAGE)).toMatchObject({ n: 0, a: 2 });
});

test("an error after the first words keeps them as a partial answer", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(
    request,
    {
      events: [
        text("بداية الإجابة "),
        {
          data: {
            id: "gen-1",
            model: GEMMA,
            error: {
              code: "server_error",
              message: "Provider disconnected unexpectedly",
            },
            choices: [
              { index: 0, delta: { content: "" }, finish_reason: "error" },
            ],
          },
        },
      ],
    },
    answer("إجابة كاملة."),
  );
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(alert(page)).toContainText("انقطعت الإجابة قبل اكتمالها.");
  await expect(answerArea(page)).toContainText("بداية الإجابة");
  await expect(study(page).locator(".ai-footer")).toBeVisible();
  await expect(
    study(page).getByRole("button", { name: "إجابة أخرى" }),
  ).toHaveCount(0);
  expect(await stored(page, CACHE)).toBeNull();
  expect(await stored(page, USAGE)).toMatchObject({ n: 1, a: 1 });
  // No second model after the first words: answers are never spliced.
  expect(await sent(request)).toHaveLength(1);

  await alert(page).getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(answerArea(page)).toContainText("إجابة كاملة.");
  await expect(answerArea(page)).not.toContainText("بداية الإجابة");
  await expect(alert(page)).toHaveCount(0);
  // Focus followed the replaced controls: retry → «إيقاف» → «إجابة أخرى».
  await expect(
    study(page).getByRole("button", { name: "إجابة أخرى" }),
  ).toBeFocused();
});

test("a stream that stalls after the first words times out as a partial answer", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(request, { events: [text("نص أول"), { hang: true }] });
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("نص أول");
  await page.clock.runFor(19000);
  await expect(answerArea(page)).toHaveAttribute("aria-busy", "true");
  await page.clock.runFor(2000);
  await expect(alert(page)).toContainText("انقطعت الإجابة قبل اكتمالها.");
  await expect(answerArea(page)).toContainText("نص أول");
  await expect.poll(async () => (await sent(request))[0].closed).toBe(true);
  expect(await sent(request)).toHaveLength(1);
  expect(await stored(page, CACHE)).toBeNull();
  expect(await stored(page, USAGE)).toMatchObject({ n: 1, a: 1 });
});

test("keep-alives extend the wait for the first words up to 60 seconds", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(request, { events: [{ keepAlive: 50 }] });
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page).locator(".ai-progress")).toHaveText(
    "النموذج يفكّر…",
  );
  // Without keep-alives the first-token timeout is 25 s.
  for (let i = 0; i < 5; i++) {
    await page.clock.runFor(10000);
    // A quiet period: give a (wrongly) timed-out stream real time to surface.
    await page.waitForTimeout(200);
    await expect(answerArea(page)).toHaveAttribute("aria-busy", "true");
  }
  await page.clock.runFor(11000);
  await expect(alert(page)).toHaveText(/الخدمة مشغولة الآن/);
  await expect(answerArea(page)).toHaveAttribute("aria-busy", "false");
  await expect.poll(async () => (await sent(request))[0].closed).toBe(true);
  expect(await stored(page, USAGE)).toMatchObject({ n: 0, a: 1 });
});

test("«إيقاف» keeps what arrived; closing the sheet ends the request", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(
    request,
    { events: [{ gate: "never" }] },
    { events: [text("جزء أول"), { hang: true }] },
    { events: [text("جزء آخر"), { hang: true }] },
  );
  await start(page);
  const stop = study(page).getByRole("button", { name: "إيقاف", exact: true });

  // Before any words (the request is out): back to the chips, no answer counted.
  await chip(page, "اشرح الآية").click();
  await expect.poll(async () => (await sent(request)).length).toBe(1);
  await stop.click();
  await expect(answerArea(page)).toHaveCount(0);
  await expect(chip(page, "اشرح الآية")).not.toHaveAttribute("aria-disabled");
  await expect(chip(page, "اشرح الآية")).toBeFocused();
  await expect(live(page)).toHaveText("أُوقفت الإجابة.");
  expect(await stored(page, USAGE)).toMatchObject({ n: 0, a: 1 });

  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("جزء أول");
  await stop.click();
  await expect(alert(page)).toContainText("أُوقفت الإجابة.");
  await expect(
    alert(page).getByRole("button", { name: "إعادة المحاولة" }),
  ).toBeFocused();
  await expect(answerArea(page)).toContainText("جزء أول");
  await expect(answerArea(page)).toHaveAttribute("aria-busy", "false");
  expect(await stored(page, CACHE)).toBeNull();
  expect(await stored(page, USAGE)).toMatchObject({ n: 1, a: 2 });

  await chip(page, "معاني الكلمات").click();
  await expect(answerArea(page)).toContainText("جزء آخر");
  await closeSheet(page);
  await expect
    .poll(async () => (await sent(request)).map((r) => r.closed))
    .toEqual([true, true, true]);
  await openCard(page);
  await expect(answerArea(page)).toHaveCount(0);
  await expect(chip(page, "معاني الكلمات")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("a reader's own question is sent as content, never cached, and can be reported", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(request, answer("لأن اللمس علامة رحمة."), answer("جواب ثانٍ."));
  await start(page);
  const field = study(page).getByLabel("اكتب سؤالك عن هذه الآية");
  const ask = study(page).getByRole("button", { name: "اسأل", exact: true });
  await field.fill("لم");
  await expect(ask).toHaveAttribute("aria-disabled", "true");
  await ask.click({ force: true });
  expect(await sent(request)).toEqual([]);

  await field.fill("  لماذا لمس يدها؟ ");
  await field.press("Enter");
  await expect(answerArea(page)).toContainText("لأن اللمس علامة رحمة.");
  await expect(live(page)).toHaveText("اكتملت الإجابة عن سؤالك");
  const [first] = await sent(request);
  expect(first.body.messages[1].content).toContain(
    "المطلوب:\nأجب عن سؤال القارئ التالي عن هذه الآية: «لماذا لمس يدها؟»",
  );
  expect(await stored(page, CACHE)).toBeNull();
  for (const label of ["اشرح الآية", "معاني الكلمات", "الخلفية والسياق"])
    await expect(chip(page, label)).toHaveAttribute("aria-pressed", "false");

  const href = await study(page)
    .getByRole("link", { name: "الإبلاغ عن خطأ" })
    .getAttribute("href");
  expect(href).toMatch(/^mailto:[^?]+@[^?]+\?subject=/);
  const body = new URL(href!).searchParams.get("body")!;
  expect(body).toContain("المرجع: متى 8:15");
  expect(body).toContain("الطلب: سؤال: لماذا لمس يدها؟");
  expect(body).toContain("النموذج: google/gemma-4-31b-it");
  expect(body).toContain("لأن اللمس علامة رحمة.");

  await study(page).getByRole("button", { name: "إجابة أخرى" }).click();
  await expect(answerArea(page)).toContainText("جواب ثانٍ.");
  const log = await sent(request);
  expect(log).toHaveLength(2);
  expect(log[1].body.messages[1].content).toContain("«لماذا لمس يدها؟»");
  expect(await stored(page, CACHE)).toBeNull();
});

test("turning the feature off clears its data until it is turned on again", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("إجابة تجريبية.");
  expect(await stored(page, CACHE)).not.toBeNull();
  const progress = await page.evaluate(
    (k) => localStorage.getItem(k),
    STATE_KEY,
  );

  await details(page).click();
  await study(page)
    .getByRole("button", { name: "إيقاف الميزة ومسح بياناتها" })
    .click();
  await expect(
    study(page).getByRole("button", { name: "تشغيل الميزة" }),
  ).toBeFocused();
  await expect(chip(page, "اشرح الآية")).toHaveCount(0);
  expect(await stored(page, CACHE)).toBeNull();
  expect(await stored(page, OFF)).toBe(1);
  expect(await stored(page, USAGE)).toMatchObject({ n: 1, a: 1 });
  expect(await page.evaluate((k) => localStorage.getItem(k), STATE_KEY)).toBe(
    progress,
  );
  await page.reload();
  await ready(page);
  await openCard(page);
  await study(page).getByRole("button", { name: "تشغيل الميزة" }).click();
  await expect(chip(page, "اشرح الآية")).toBeFocused();
  expect(await stored(page, OFF)).toBeNull();
  expect(await sent(request)).toHaveLength(1);
});

test("every AI state is accessible in both themes and fits 320px at 38px text", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await page.addInitScript(() => localStorage.setItem("word-font", "38"));
  await page.setViewportSize({ width: 320, height: 700 });
  const check = async () => {
    await noOverflow(page);
    await expectAccessible(page, { include: "dialog[open]", wcag: true });
  };
  for (const dark of [false, true]) {
    await page.goto("/");
    await ready(page);
    await page.evaluate(
      ({ dark, keys }) => {
        document.documentElement.dataset.theme = dark ? "dark" : "light";
        for (const key of keys) localStorage.removeItem(key);
      },
      { dark, keys: [CACHE, USAGE, OFF] },
    );
    await queue(
      request,
      {
        events: [
          { comment: "OPENROUTER PROCESSING" },
          { gate: `a${+dark}` },
          text(
            "**المعنى:** نص عربي طويل يمتد على عدة أسطر في الشاشة الضيقة.\n\n- نقطة أولى\n- نقطة ثانية",
          ),
          ...done(),
        ],
      },
      { status: 503, json: { error: { code: 503, message: "down" } } },
    );
    await openCard(page);
    await details(page).click();
    await check(); // details
    await details(page).click();
    await chip(page, "اشرح الآية").click();
    await expect(answerArea(page).locator(".ai-progress")).toBeVisible();
    await check(); // loading
    await open(request, `a${+dark}`);
    await expect(answerArea(page).locator("li")).toHaveCount(2);
    await expect(answerArea(page)).toHaveAttribute("aria-busy", "false");
    await check(); // answer
    await chip(page, "الخلفية والسياق").click();
    await expect(
      alert(page).getByRole("button", { name: "إعادة المحاولة" }),
    ).toHaveAttribute("aria-disabled", "true");
    await check(); // error, retry cooling down
    await page.evaluate(
      ([key]) =>
        localStorage.setItem(
          key,
          JSON.stringify({ date: "2026-10-01", n: 10, a: 10 }),
        ),
      [USAGE],
    );
    await chip(page, "معاني الكلمات").click();
    await expect(alert(page)).toContainText("وصلت للحد اليومي");
    await check(); // cap
    await closeSheet(page);
  }
});

test("«إيقاف» works while the study files are still loading, and nothing is sent", async ({
  page,
  request,
}) => {
  await seedAi(page);
  // The translations file never arrives.
  await page.route("**/study/10.tr.json*", () => {});
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toHaveAttribute("aria-busy", "true");
  await study(page).getByRole("button", { name: "إيقاف", exact: true }).click();
  await expect(answerArea(page)).toHaveCount(0);
  await expect(chip(page, "اشرح الآية")).toBeFocused();
  expect(await sent(request)).toEqual([]);
  // No request went out, so no daily attempt was spent.
  expect(await stored(page, USAGE)).toBeNull();
});

test("«إجابة أخرى» is offered only when it could run", async ({
  page,
  request,
}) => {
  await seedAi(page, { usage: { date: "2026-10-01", n: 9, a: 9 } });
  await queue(request, answer("الإجابة العاشرة."));
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(answerArea(page)).toContainText("الإجابة العاشرة.");
  await expect(remaining(page)).toContainText("٠ من ١٠");
  // At the device cap a new request would only replace this answer.
  await expect(
    study(page).getByRole("button", { name: "إجابة أخرى" }),
  ).toHaveCount(0);
  await expect(
    study(page).getByRole("link", { name: "الإبلاغ عن خطأ" }),
  ).toBeVisible();

  // During a cooldown it waits, disabled. (Session counts outlive edits to
  // storage, so start a new page session below the cap.)
  await page.evaluate(
    ([key]) =>
      localStorage.setItem(
        key,
        JSON.stringify({ date: "2026-10-01", n: 1, a: 1 }),
      ),
    [USAGE],
  );
  await page.reload();
  await ready(page);
  await openCard(page);
  await queue(request, {
    status: 503,
    json: { error: { code: 503, message: "down" } },
  });
  await chip(page, "الخلفية والسياق").click();
  await expect(alert(page)).toContainText("الخدمة مشغولة الآن.");
  await chip(page, "اشرح الآية").click();
  const another = study(page).getByRole("button", { name: "إجابة أخرى" });
  await expect(another).toHaveAttribute("aria-disabled", "true");
  await page.clock.runFor(5100);
  await expect(another).not.toHaveAttribute("aria-disabled");
});

test("a rate-limit wait is bounded even when the reset time is far off", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(request, {
    status: 429,
    json: {
      error: {
        code: 429,
        message: "Rate limit exceeded: free-models-per-min. ",
        metadata: {
          headers: {
            "X-RateLimit-Reset": String(Date.parse("2026-10-01T13:00:00Z")),
          },
          provider_name: null,
        },
      },
    },
  });
  await start(page);
  await chip(page, "اشرح الآية").click();
  const retry = alert(page).getByRole("button", { name: "إعادة المحاولة" });
  await expect(retry).toHaveAttribute("aria-disabled", "true");
  await page.clock.runFor(66000);
  await expect(retry).not.toHaveAttribute("aria-disabled");
});

test("an answer that is only hidden reasoning is empty and backs off", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(request, answer("<think>تفكير فقط</think>"));
  await start(page);
  await chip(page, "اشرح الآية").click();
  await expect(alert(page)).toContainText("لم تصل إجابة هذه المرة.");
  const retry = alert(page).getByRole("button", { name: "إعادة المحاولة" });
  await expect(retry).toHaveAttribute("aria-disabled", "true");
  await page.clock.runFor(5100);
  await expect(retry).not.toHaveAttribute("aria-disabled");
  expect(await stored(page, USAGE)).toMatchObject({ n: 0, a: 1 });
  expect(await stored(page, CACHE)).toBeNull();
});

test("a numbered list split by a paragraph keeps its numbering", async ({
  page,
  request,
}) => {
  await seedAi(page);
  await queue(request, answer("1. أولًا\n2. ثانيًا\nتوضيح\n3. ثالثًا"));
  await start(page);
  await chip(page, "معاني الكلمات").click();
  const lists = answerArea(page).locator("ol");
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(0)).not.toHaveAttribute("start");
  await expect(lists.nth(1)).toHaveAttribute("start", "3");
});

test("عن التطبيق (About) discloses the AI service", async ({ page }) => {
  await seedAi(page);
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
  await page
    .getByRole("dialog", { name: "القائمة", exact: true })
    .getByRole("button", { name: "عن التطبيق" })
    .click();
  const about = page.getByRole("dialog", {
    name: "عن التطبيق",
    exact: true,
  });
  await expect(about).toContainText("شرح الآيات بالذكاء الاصطناعي اختياري");
  await expect(about).toContainText("لا يُرسَل اسمك أو تقدّمك");
  await noOverflow(page);
  await expectAccessible(page);
});

test("only the AI build carries the key, and only in its lazy request chunk", () => {
  const files = (dir: string) => {
    const assets = fileURLToPath(
      new URL(`../../${dir}/assets/`, import.meta.url),
    );
    return readdirSync(assets).map((name) => ({
      name,
      text: readFileSync(assets + name, "utf8"),
    }));
  };
  const ai = files("dist-ai");
  expect(ai.filter((f) => f.text.includes(AI_KEY)).map((f) => f.name)).toEqual([
    expect.stringMatching(/^run-[\w-]+\.js$/),
  ]);
  expect(
    ai.filter((f) => /^index-/.test(f.name) && /openrouter/i.test(f.text)),
  ).toEqual([]);
  const plain = files("dist");
  expect(plain.filter((f) => /openrouter|اسأل الذكاء/i.test(f.text))).toEqual(
    [],
  );
  expect(plain.some((f) => /^(AiPanel|run)-/.test(f.name))).toBe(false);
});
