import { PROMPT_VERSION } from "./domain/chips.ts";
import { modelLabel } from "./format.ts";
import { clip, wellFormed } from "./domain/text.ts";

/**
 * «الإبلاغ عن خطأ»: a mailto link carrying the reference, the request, the
 * model, the prompt version and the start of the answer. The answer is model
 * output: it is clipped and stripped of lone surrogates, which would make
 * encodeURIComponent throw.
 */
export function reportMailto({
  email,
  reference,
  asking,
  model,
  text,
}: {
  email: string;
  reference: string;
  /** The chip's label, or «سؤال: …» for a typed question. */
  asking?: string;
  model?: string;
  text: string;
}) {
  const body = wellFormed(
    [
      `المرجع: ${reference}`,
      `الطلب: ${asking ?? ""}`,
      `النموذج: ${modelLabel(model)}`,
      `إصدار الطلب: ${PROMPT_VERSION}`,
      "",
      clip(text, 1500),
    ].join("\n"),
  );
  return `mailto:${email}?subject=${encodeURIComponent(
    "خطأ في إجابة الذكاء الاصطناعي",
  )}&body=${encodeURIComponent(body)}`;
}
