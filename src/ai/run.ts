// The only module that holds the provider configuration (and so the public
// key). It is a separate lazy chunk, loaded on the first uncached request.
import {
  verseTranslations,
  verseWords,
  wordDefinitions,
  studyReference,
} from "../study/canonicalClient.ts";
import type { WordToken } from "../study/types.ts";
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
  /** The canonical verse (GEN.1.1). */
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
  if (signal.aborted) throw new AiError("aborted");
  const needsWords = input.chip === "words" || input.chip === "ask";
  const verse = String(studyReference(input.id).verse);
  const wordContext = async () => {
    if (!needsWords) return undefined;
    const data = await verseWords.load(input.id);
    const words = data.verses[verse]?.w ?? [];
    return { words, lex: await wordDefinitions(words) };
  };
  // Each resource is optional context. Stop cancels the AI run immediately,
  // while deduplicated static requests may finish for an open study section.
  const [tr, context] = await abortable(
    Promise.allSettled([
      verseTranslations.load(input.id).then((data) => data.verses[verse]),
      wordContext(),
    ]),
    signal,
  );
  const words: WordToken[] | undefined =
    context.status === "fulfilled" ? context.value?.words : undefined;
  const request = buildPrompt(
    input.chip,
    {
      ...input.material,
      words: words ?? input.material.words,
      tr: tr.status === "fulfilled" ? tr.value : undefined,
      lex: context.status === "fulfilled" ? context.value?.lex : undefined,
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
