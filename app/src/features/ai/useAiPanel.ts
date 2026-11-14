import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { browserStorage, turnOff, turnOn, isTurnedOff } from "./cache.ts";
import { CHIPS, cleanQuestion, QUESTION_MIN } from "./domain/chips.ts";
import { createGuards } from "./guards.ts";
import { reportMailto } from "./report.ts";
import { startAnswer, type View } from "./request.ts";
import type { AiStatus, ChipId } from "./domain/types.ts";
import { APP_INFO } from "../../shared/lib/appInfo";
import type { Passage, Verse } from "../../core/scripture/types";
import { aiStatus } from "./data/client.ts";
import { reveal } from "../../shared/ui/reveal";

// Cooldowns persist across panel remounts; the server owns quota decisions.
const guards = createGuards();

export type AiPanelProps = { id: string; passage: Passage; verse: Verse };

export function useAiPanel({ id, passage, verse }: AiPanelProps) {
  const lastChip = useRef<ChipId | null>(null);
  const storage = useMemo(browserStorage, []);
  const [on, setOn] = useState(() => !isTurnedOff(storage));
  const [details, setDetails] = useState(false);
  const [view, setView] = useState<View>({ s: "idle" });
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [quota, setQuota] = useState<AiStatus>();
  const challengeRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const [, setTick] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const runs = useRef(0);
  const answerRef = useRef<HTMLDivElement>(null);
  const busy = view.s === "loading" || view.s === "streaming";

  useEffect(() => {
    if (!on) return;
    const control = new AbortController();
    void aiStatus(control.signal)
      .then(setQuota)
      .catch(() => {});
    return () => control.abort();
  }, [on]);

  // Closing the sheet, or another verse or day, ends a request in flight.
  useEffect(() => () => controller.current?.abort("unmount"), []);

  // Re-enable «إعادة المحاولة» and «إجابة أخرى» when a cooldown ends.
  const cooling = !busy && view.s !== "idle" && guards.remaining() > 0;
  useEffect(() => {
    if (!cooling) return;
    const timer = setTimeout(
      () => setTick((n) => n + 1),
      guards.remaining() + 50,
    );
    return () => clearTimeout(timer);
  }, [cooling, view]);

  async function run(
    chip: ChipId,
    options: { fresh?: boolean; question?: string } = {},
  ) {
    if (controller.current) return;
    const text = chip === "ask" ? cleanQuestion(options.question ?? "") : "";
    if (chip === "ask") {
      if (text.length < QUESTION_MIN) return;
      setAsked(text);
    }
    const n = ++runs.current;
    lastChip.current = chip;
    const started = startAnswer(
      {
        chip,
        id,
        challengeElement: challengeRef.current ?? undefined,
        cacheRevision: quota?.available ? quota.cacheRevision : undefined,
        question: text,
        fresh: options.fresh,
        n,
      },
      { storage, guards },
      {
        view: setView,
        status: setStatus,
        quota: setQuota,
        answered() {
          requestAnimationFrame(() => {
            if (answerRef.current) reveal(answerRef.current);
          });
        },
      },
    );
    if (!started) return;
    controller.current = started.controller;
    await started.done;
    if (controller.current === started.controller) controller.current = null;
  }

  function submitQuestion(event: FormEvent) {
    event.preventDefault();
    const text = cleanQuestion(question);
    if (text.length >= QUESTION_MIN && !busy)
      void run("ask", { fresh: true, question: text });
  }

  const chip = view.s === "idle" ? undefined : view.chip;
  const text =
    view.s === "streaming" || view.s === "done"
      ? view.text
      : view.s === "error"
        ? view.partial
        : undefined;
  const model =
    view.s === "streaming" || view.s === "done" || view.s === "error"
      ? view.model
      : undefined;
  const questionText = cleanQuestion(question);
  const reference = `${passage.book} ${passage.chapter}:${verse.number}`;
  const asking =
    chip === "ask" ? `سؤال: ${asked}` : CHIPS.find((c) => c.id === chip)?.label;
  const report =
    text && !busy
      ? reportMailto({ email: APP_INFO.email, reference, asking, model, text })
      : undefined;
  // Keep retry controls disabled during the session cooldown.
  const blocked = busy || view.s === "idle" ? undefined : guards.refusal();
  const final = !!(
    quota &&
    Date.now() < quota.resets.device &&
    (quota.usage.answers >= quota.limits.answers ||
      quota.usage.attempts >= quota.limits.attempts)
  );
  const waiting = blocked === "rate";

  function enable() {
    turnOn(storage);
    setOn(true);
  }

  function disable() {
    controller.current?.abort("unmount");
    turnOff(storage);
    lastChip.current = null;
    setOn(false);
    setDetails(false);
    setView({ s: "idle" });
    setStatus("");
  }

  return {
    on,
    details,
    setDetails,
    view,
    question,
    setQuestion,
    asked,
    quota,
    challengeRef,
    status,
    answerRef,
    lastChip,
    busy,
    run,
    submitQuestion,
    chip,
    text,
    model,
    questionText,
    report,
    final,
    waiting,
    enable,
    disable,
    stop: () => controller.current?.abort("stop"),
  };
}
