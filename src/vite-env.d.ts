/// <reference types="vite/client" />
// Inlined by vite.config.ts from VITE_AUDIO_BASE_URL (see src/domain/audio/url.ts).
declare const __AUDIO_BASE_URL__: string;
declare const __AUDIO_DAYS__: number[];
/** One "1"/"0" per canonical chapter (src/domain/audio/availability.ts). */
declare const __AUDIO_CHAPTERS__: string;

// Only public AI settings are inlined. Credentials never enter browser builds.
declare const __AI_ENABLED__: boolean;
declare const __TURNSTILE_SITE_KEY__: string;
declare const __DATA_VERSIONS__: Record<string, string>;
