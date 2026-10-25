/// <reference types="vite/client" />
// Inlined by vite.config.ts from VITE_AUDIO_BASE_URL (see src/audio/url.ts).
declare const __AUDIO_BASE_URL__: string;
declare const __AUDIO_DAYS__: number[];
/** One "1"/"0" per canonical chapter (src/audio/availability.ts). */
declare const __AUDIO_CHAPTERS__: string;

// Inlined by vite.config.ts from the VITE_AI_* variables (see src/ai/config.ts).
declare const __AI_ENABLED__: boolean;
declare const __AI_DAILY_CAP__: number;
declare const __AI_ATTEMPT_CAP__: number;
declare const __AI_CONFIG__: import("./ai/config.ts").AiBuildConfig | null;
