import {
  answerKey,
  readAnswer,
  recordAnswer,
  recordAttempt,
  saveAnswer,
  type StorageLike,
} from "./cache.ts";
import { CHIPS, PROMPT_VERSION } from "./chips.ts";
import { cleanAnswer, clip, MAX_TEXT } from "./format.ts";
import type { Guards, Problem } from "./guards.ts";
import type { AskInput } from "./run.ts";
import { abortable, AiError, type ChipId } from "./types.ts";

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
  material: AskInput["material"];
  /** The reader's cleaned question («ask» only). */
  question: string;
  /** Skip the cached answer (retry, «إجابة أخرى», a typed question). */
  fresh?: boolean;
  /** The panel's run number, for error alerts. */
  n: number;
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
};

/**
 * One answer. A cached answer or a refusal settles at once and returns
 * undefined. Otherwise the request starts and its controller is returned:
 * aborting it with an `AbortReason` ends the request immediately, while
 * shared static loads it started may finish for the study sections. `done`
 * never rejects.
 *
 * Accounting: an attempt is recorded only when the network request goes out
 * (`ask`'s onSend), an answer once its first visible text arrives.
 */
export function startAnswer(
  { chip, id, material, question, fresh, n }: AnswerInput,
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
  const key = chip === "ask" ? null : answerKey(id, chip, PROMPT_VERSION);
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
    if (key)
      saveAnswer(
        storage,
        key,
        truncated
          ? { text: answer, model: model ?? "", truncated: true }
          : { text: answer, model: model ?? "" },
        PROMPT_VERSION,
      );
    events.view({ s: "done", chip, text: answer, model, truncated });
    events.status(finished(chip));
  };

  const run = async () => {
    try {
      // Neither the chunk nor the study files may delay «إيقاف».
      const { ask } = await abortable(load(), controller.signal);
      const meta = await ask(
        { chip, id, material, question },
        controller.signal,
        {
          onText(delta) {
            raw += delta;
            const shown = cleanAnswer(raw);
            if (!shown) return;
            if (!counted) {
              // The shared allowance is spent and the reader got something.
              counted = true;
              events.answered(recordAnswer(storage, date).n);
            }
            if (shown.length > MAX_TEXT) {
              truncated = true;
              controller.abort("truncated" satisfies AbortReason);
              return;
            }
            frame ||= schedule(flush);
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
        () => recordAttempt(storage, date),
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
