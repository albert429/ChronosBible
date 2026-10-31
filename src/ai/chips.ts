import type { ChipId } from "./types.ts";

/** Bump when the prompt, chips or models change: cached answers are dropped. */
export const PROMPT_VERSION = 3;
export const QUESTION_MIN = 3;
export const QUESTION_MAX = 200;

export const CHIPS: readonly { id: Exclude<ChipId, "ask">; label: string }[] = [
  { id: "explain", label: "اشرح الآية" },
  { id: "words", label: "معاني الكلمات" },
  { id: "background", label: "الخلفية والسياق" },
];

/** A reader's question as plain text: no control or bidi characters. */
export function cleanQuestion(raw: string) {
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
