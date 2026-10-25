// The only module that holds the provider configuration (and so the public
// key). It is a separate lazy chunk, loaded on the first uncached request.
import { studyLex, studyTr } from "../study/client.ts";
import { runChain } from "./chain.ts";
import { buildPrompt, type Material } from "./prompt.ts";
import { createOpenRouter } from "./providers/openrouter.ts";
import {
  abortable,
  AiError,
  type AiMeta,
  type AiProvider,
  type ChipId,
  type StreamCallbacks,
} from "./types.ts";

let providers: AiProvider[] | undefined;
/** Providers that failed authentication; skipped until the page reloads. */
const disabled = new Set<string>();

export type AskInput = {
  chip: ChipId;
  day: number;
  id: string;
  material: Omit<Material, "tr" | "lex">;
  question?: string;
};

/**
 * One request. `onSend` runs just before the network request goes out, so a
 * reader who stops while the study files load spends no daily attempt.
 */
export async function ask(
  input: AskInput,
  signal: AbortSignal,
  callbacks: StreamCallbacks,
  onSend?: () => void,
): Promise<AiMeta> {
  const day = String(input.day);
  // Shared with the study cards' cache; a failure only omits a block. They
  // race the signal: «إيقاف» must not wait for them (they finish for the cards).
  const greek = input.chip === "words" || input.chip === "ask";
  const [tr, lex] = await abortable(
    Promise.allSettled([
      studyTr.load(day),
      greek ? studyLex.load(day) : Promise.resolve(undefined),
    ]),
    signal,
  );
  const request = buildPrompt(
    input.chip,
    {
      ...input.material,
      tr: tr.status === "fulfilled" ? tr.value.verses[input.id] : undefined,
      lex: lex.status === "fulfilled" ? lex.value?.lex : undefined,
    },
    input.question,
  );
  providers ??= (__AI_CONFIG__?.providers ?? []).map((config) =>
    createOpenRouter({
      ...config,
      referer: location.origin + "/",
      title: "ChronosBible",
    }),
  );
  if (signal.aborted) throw new AiError("aborted");
  onSend?.();
  return runChain(providers, request, signal, callbacks, { disabled });
}
