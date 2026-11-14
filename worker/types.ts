import type {
  AiMeta,
  StreamCallbacks,
} from "../src/features/ai/domain/types.ts";

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
