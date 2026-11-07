import { cleanAnswer, clip, wellFormed } from "../src/domain/ai/text.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { modelLabel, parseAnswer } from "../src/features/ai/format.ts";

const texts = (blocks: unknown) => JSON.stringify(blocks);

test("HTML-looking output stays literal text in the AST", () => {
  const blocks = parseAnswer(
    cleanAnswer("<img src=x onerror=alert(1)> <script>alert(1)</script>"),
  );
  assert.deepEqual(blocks, [
    {
      kind: "p",
      inlines: [
        { text: "<img src=x onerror=alert(1)> <script>alert(1)</script>" },
      ],
    },
  ]);
});

test("Links keep only their text; images and code fences are removed", () => {
  const text = cleanAnswer(
    "انظر [هنا](javascript:alert(1)) ![صورة](https://t.example/p.png)\n```js\nx\n```",
  );
  assert.equal(text, "انظر هنا \n\nx");
  assert.doesNotMatch(text, /javascript|https/);
});

test("Bidi overrides, control characters and hidden reasoning are stripped", () => {
  assert.equal(cleanAnswer("a‮b⁦c\u0007d‍e‏f"), "abcd‍e‏f");
  assert.equal(cleanAnswer("<think>تفكير</think>الجواب"), "الجواب");
  assert.equal(cleanAnswer("الجواب<THINK>ما زال"), "الجواب");
  assert.equal(cleanAnswer("<think>only reasoning"), "");
});

test("Paragraphs, lists, headings and bold become blocks", () => {
  const blocks = parseAnswer(
    "# العنوان\nفقرة **مهمة** هنا\n\n- أولًا\n• ثانيًا\n١. واحد\n2) اثنان\n---\n> اقتباس **غير مغلق",
  );
  assert.deepEqual(blocks, [
    { kind: "p", inlines: [{ text: "العنوان", bold: true }] },
    {
      kind: "p",
      inlines: [
        { text: "فقرة " },
        { text: "مهمة", bold: true },
        { text: " هنا" },
      ],
    },
    { kind: "ul", items: [[{ text: "أولًا" }], [{ text: "ثانيًا" }]] },
    { kind: "ol", start: 1, items: [[{ text: "واحد" }], [{ text: "اثنان" }]] },
    { kind: "p", inlines: [{ text: "اقتباس **غير مغلق" }] },
  ]);
});

test("A numbered list split by a paragraph continues from the model's number", () => {
  const blocks = parseAnswer("1. أ\n2. ب\nفقرة\n3. ج\n٤) د");
  assert.deepEqual(
    blocks.map((b) => [
      b.kind,
      b.kind === "ol" ? b.start : undefined,
      "items" in b ? b.items.length : 0,
    ]),
    [
      ["ol", 1, 2],
      ["p", undefined, 0],
      ["ol", 3, 2],
    ],
  );
  const [list] = parseAnswer("٧. سابعًا");
  assert.equal(list.kind === "ol" ? list.start : undefined, 7);
});

test("Lone surrogates are dropped, so the text always URI-encodes", () => {
  assert.equal(wellFormed("a\uD83Db\uDE00c😀"), "abc😀");
  assert.equal(cleanAnswer("x\uDC00y"), "xy");
  assert.equal(clip("😀😀", 3), "😀");
  const long = "ا".repeat(1499) + "😀";
  assert.doesNotThrow(() => encodeURIComponent(clip(long, 1500)));
  assert.throws(() => encodeURIComponent(long.slice(0, 1500)), URIError);
});

test("Pathological input parses quickly (no catastrophic backtracking)", () => {
  const nasty = "*".repeat(50000) + "[".repeat(50000) + "](" + "a".repeat(1000);
  const started = Date.now();
  parseAnswer(cleanAnswer(nasty));
  assert.ok(Date.now() - started < 200, texts(Date.now() - started));
});

test("Model names are sanitised for the footer", () => {
  assert.equal(
    modelLabel("google/gemma-4-31b-it:free"),
    "google/gemma-4-31b-it",
  );
  assert.equal(modelLabel("<b>x</b>"), "نموذج غير معروف");
  assert.equal(modelLabel(undefined), "نموذج غير معروف");
  assert.equal(modelLabel("a".repeat(90)), "نموذج غير معروف");
});
