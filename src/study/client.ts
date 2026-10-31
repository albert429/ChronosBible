import { createJsonClient } from "../lib/jsonClient.ts";
import { dataUrl } from "../lib/dataVersion.ts";
import type { LexDay, StudyDay, TrDay } from "./types.ts";

const message = () => "تعذر تحميل دراسة الآية. تحقق من الاتصال وحاول مرة أخرى.";
const header = (data: unknown, key: string) =>
  !!data &&
  typeof data === "object" &&
  (data as { v?: unknown }).v === 1 &&
  (data as { day?: unknown }).day === Number(key);
const isObject = (value: unknown) =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const studyCore = createJsonClient<StudyDay>({
  url: (day) => dataUrl(`/study/${day}.json`),
  validate: (data, key): data is StudyDay =>
    header(data, key) &&
    Array.isArray((data as StudyDay).p) &&
    isObject((data as StudyDay).verses),
  message,
});
export const studyTr = createJsonClient<TrDay>({
  url: (day) => dataUrl(`/study/${day}.tr.json`),
  validate: (data, key): data is TrDay =>
    header(data, key) && isObject((data as TrDay).verses),
  message: () => "تعذر تحميل الترجمات. تحقق من الاتصال وحاول مرة أخرى.",
});
export const studyLex = createJsonClient<LexDay>({
  url: (day) => dataUrl(`/study/${day}.lex.json`),
  validate: (data, key): data is LexDay =>
    header(data, key) && isObject((data as LexDay).lex),
  message,
});
