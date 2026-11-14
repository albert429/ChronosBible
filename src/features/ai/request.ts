import {
  answerKey,
  readAnswer,
  saveAnswer,
  type StorageLike,
} from "./cache.ts";
import { CHIPS, PROMPT_VERSION } from "./domain/chips.ts";
import { cleanAnswer, clip, MAX_TEXT } from "./domain/text.ts";
import type { Guards, Problem } from "./guards.ts";
import type { AskInput } from "./run.ts";
import { AiError, type ChipId, type AiStatus } from "./domain/types.ts";
import { abortable } from "./data/abortable.ts";

/** What the panel shows for the current request. */
export type View =
  | { s: "idle" }
  | { s: "loading"; chip: ChipId; thinking: boolean }
  | { s: "streaming"; chip: ChipId; text: string; model?: string }
  | {
      s: "done";
      chip: ChipId;
      text: string;
      model?: string;
      truncated: boolean;
    }
  | {
      s: "error";
      chip: ChipId;
      problem: Problem;
      partial?: string;
      model?: string;
      /** The run that failed: a repeated, identical alert is announced again. */
      n: number;
    };

/**
 * Why a request's controller aborted: the reader's «إيقاف», the panel going
 * away (closing the sheet, another verse, turning the feature off), or an
 * answer longer than the card keeps.
 */
export type AbortReason = "stop" | "unmount" | "truncated";

export const finished = (chip: ChipId) =>
  chip === "ask"
    ? "اكتملت الإجابة عن سؤالك"
    : `اكتملت الإجابة: ${CHIPS.find((c) => c.id === chip)?.label}`;

export type AnswerInput = {
  chip: ChipId;
  /** The canonical verse (GEN.1.1). */
  id: string;
  challengeElement?: AskInput["challengeElement"];
  /** The reader's cleaned question («ask» only). */
  question: string;
  /** Skip the cached answer (retry, «إجابة أخرى», a typed question). */
  fresh?: boolean;
  /** The panel's run number, for error alerts. */
  n: number;
  cacheRevision?: string;
};

export type AnswerDeps = {
  storage: StorageLike | null;
  guards: Guards;
  /** Today's date for the daily counts. */
  date: string;
  /** The lazy request module; loaded on the first uncached request. */
  load?: () => Promise<Pick<typeof import("./run.ts"), "ask">>;
  frame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
};

export type AnswerEvents = {
  view(next: View | ((view: View) => View)): void;
  status(text: string): void;
  /** The first visible text: one answer spent today (`used` answers so far). */
  answered(used: number): void;
  quota?(quota: AiStatus): void;
};

/**
 * One answer. A cached answer or a refusal settles at once and returns
 * undefined. Otherwise the request starts and its controller is returned:
 * aborting it with an `AbortReason` ends the request immediately, while
 * shared static loads it started may finish for the study sections. `done`
 * never rejects.
 *
 * Accounting comes from server quota events. Local storage never authorizes
 * a generation or blocks a shared-cache request.
 */
export function startAnswer(
  {
    chip,
    id,
    challengeElement,
    question,
    fresh,
    n,
    cacheRevision,
  }: AnswerInput,
  {
    storage,
    guards,
    date,
    load = () => import("./run.ts"),
    frame: schedule = (callback) => requestAnimationFrame(callback),
    cancelFrame = (handle) => cancelAnimationFrame(handle),
  }: AnswerDeps,
  events: AnswerEvents,
): { controller: AbortController; done: Promise<void> } | undefined {
  const revision =
    cacheRevision ??
    (typeof __DATA_VERSIONS__ === "undefined"
      ? String(PROMPT_VERSION)
      : `${PROMPT_VERSION}:${__DATA_VERSIONS__.bible}:${__DATA_VERSIONS__.study}`);
  const key = chip === "ask" ? null : answerKey(id, chip, revision);
  if (key && !fresh) {
    const cached = readAnswer(storage, key);
    if (cached) {
      events.view({
        s: "done",
        chip,
        ...cached,
        truncated: !!cached.truncated,
      });
      events.status(finished(chip));
      return;
    }
  }
  const refused = guards.refusal(storage, date);
  if (refused) {
    events.view({ s: "error", chip, problem: refused, n });
    return;
  }

  const controller = new AbortController();
  events.view({ s: "loading", chip, thinking: false });
  events.status("جارٍ إعداد الإجابة…");
  let raw = "";
  let model: string | undefined;
  let counted = false;
  let truncated = false;
  let frame = 0;
  const flush = () => {
    frame = 0;
    const shown = cleanAnswer(raw);
    if (shown) events.view({ s: "streaming", chip, text: shown, model });
  };
  const finish = () => {
    const answer = clip(cleanAnswer(raw), MAX_TEXT);
    if (!answer) {
      guards.backOff("empty");
      events.view({ s: "error", chip, problem: "empty", n });
      events.status("");
      return;
    }
    guards.answered();
    if (key && !truncated)
      saveAnswer(
        storage,
        key,
        truncated
          ? { text: answer, model: model ?? "", truncated: true }
          : { text: answer, model: model ?? "" },
        revision,
      );
    events.view({ s: "done", chip, text: answer, model, truncated });
    events.status(finished(chip));
  };

  const run = async () => {
    try {
      // Neither the chunk nor the study files may delay «إيقاف».
      const { ask } = await abortable(load(), controller.signal);
      const meta = await ask(
        { chip, id, challengeElement, question, fresh },
        controller.signal,
        {
          onText(delta) {
            raw += delta;
            const shown = cleanAnswer(raw);
            if (!shown) return;
            if (!counted) {
              // Reveal the answer; server quota events supply the count.
              counted = true;
              events.answered(0);
            }
            if (shown.length > MAX_TEXT) {
              truncated = true;
              controller.abort("truncated" satisfies AbortReason);
              return;
            }
            frame ||= schedule(flush);
          },
          onSnapshot(text) {
            raw = text;
            if (!counted && text) {
              counted = true;
              events.answered(0);
            }
            frame ||= schedule(flush);
          },
          onQuota(quota) {
            events.quota?.(quota);
          },
          onMeta(name) {
            model = name;
          },
          onActivity() {
            events.view((v) =>
              v.s === "loading" ? { ...v, thinking: true } : v,
            );
          },
        },
      );
      model = meta.model || model;
      truncated ||= meta.finish === "length";
      finish();
    } catch (error) {
      const reason = controller.signal.reason as AbortReason | undefined;
      if (reason === "truncated") return finish();
      if (reason === "unmount") return;
      const failure = error instanceof AiError ? error : new AiError("network");
      model = failure.model ?? model;
      const partial = clip(cleanAnswer(raw), MAX_TEXT) || undefined;
      events.status("");
      if (reason === "stop") {
        if (partial)
          events.view({
            s: "error",
            chip,
            problem: "stopped",
            partial,
            model,
            n,
          });
        else {
          events.view({ s: "idle" });
          events.status("أُوقفت الإجابة.");
        }
        return;
      }
      if (partial) {
        events.view({
          s: "error",
          chip,
          problem: failure.kind,
          partial,
          model,
          n,
        });
        return;
      }
      guards.backOff(failure.kind, failure.retryAt);
      events.view({ s: "error", chip, problem: failure.kind, n });
    } finally {
      cancelFrame(frame);
    }
  };
  return { controller, done: run() };
}
