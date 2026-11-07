import type { AiMeta, StreamCallbacks } from "../src/domain/ai/types.ts";

export type AiRequest = {
  system: string;
  prompt: string;
  maxOutputTokens: number;
};

export type AiProvider = {
  id: string;
  stream(
    request: AiRequest,
    signal: AbortSignal,
    callbacks: StreamCallbacks,
  ): Promise<AiMeta>;
};
