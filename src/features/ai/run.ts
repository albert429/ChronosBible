import { answer } from "./data/client.ts";
import { AiError, type ChipId, type StreamCallbacks } from "./domain/types.ts";
import { challenge } from "./turnstile.ts";
export type AskInput = {
  chip: ChipId;
  id: string;
  question?: string;
  fresh?: boolean;
  challengeElement?: HTMLElement;
};
export async function ask(
  input: AskInput,
  signal: AbortSignal,
  callbacks: StreamCallbacks,
  onSend?: () => void,
) {
  if (!input.challengeElement) throw new AiError("challenge");
  const token = await challenge(input.challengeElement, signal);
  signal.throwIfAborted();
  onSend?.();
  return answer(
    {
      verseId: input.id,
      chip: input.chip,
      ...(input.chip === "ask" ? { question: input.question } : {}),
      fresh: input.fresh,
      turnstileToken: token,
    },
    signal,
    callbacks,
  );
}
