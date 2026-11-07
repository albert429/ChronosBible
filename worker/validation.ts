import { catalog, findBibleBook } from "../src/domain/scripture/catalog.ts";
import {
  cleanQuestion,
  QUESTION_MIN,
  QUESTION_MAX,
} from "../src/domain/ai/chips.ts";
import { AiError, type AnswerRequest } from "../src/domain/ai/types.ts";

export function reference(id: string) {
  const match = /^([1-3]?[A-Z]{2,3})\.([1-9]\d{0,2})\.([1-9]\d{0,2})$/.exec(id);
  const book = match && findBibleBook(catalog, match[1]);
  const chapter = Number(match?.[2]);
  const verse = Number(match?.[3]);
  if (!book || verse > (book.verseCounts[chapter - 1] ?? 0))
    throw new AiError("invalid");
  return { book, chapter, verse };
}
export function validate(value: unknown): AnswerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AiError("invalid");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) =>
        !["verseId", "chip", "question", "fresh", "turnstileToken"].includes(k),
    ) ||
    typeof v.verseId !== "string" ||
    typeof v.chip !== "string" ||
    !["explain", "words", "background", "ask"].includes(String(v.chip)) ||
    (v.fresh !== undefined && typeof v.fresh !== "boolean") ||
    typeof v.turnstileToken !== "string" ||
    !v.turnstileToken.length ||
    v.turnstileToken.length > 2048
  )
    throw new AiError("invalid");
  reference(v.verseId);
  if (v.chip === "ask") {
    if (typeof v.question !== "string" || v.question.length > QUESTION_MAX)
      throw new AiError("invalid");
    const question = cleanQuestion(v.question);
    v.question = question;
    if (question.length < QUESTION_MIN) throw new AiError("invalid");
  } else if (v.question !== undefined) throw new AiError("invalid");
  return v as AnswerRequest;
}
