// Composition only: each build responsibility lives in scripts/build/.
// Settings come from VITE_* variables and are validated here, then inlined as
// constants, so a disabled feature leaves no code in the bundle.
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { aiBuildConfig } from "./src/features/ai/config.ts";
import { audioPublication } from "./scripts/build/audio-publication.ts";
import {
  dataVersions,
  dataVersionsHtml,
} from "./scripts/build/data-versions.ts";
import { removeUnpublishedManifests } from "./scripts/build/manifest-filter.ts";
import { serviceWorker } from "./scripts/build/service-worker.ts";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const audio = audioPublication(env);
  // Optional AI explanations: off unless VITE_AI_PROVIDERS is set. Values are
  // inlined as constants so a disabled build drops every AI module.
  const ai = aiBuildConfig(env);
  const versions = dataVersions();
  return {
    plugins: [
      react(),
      removeUnpublishedManifests(audio.published),
      serviceWorker(versions),
      dataVersionsHtml(versions),
    ],
    define: {
      __AUDIO_BASE_URL__: JSON.stringify(audio.base),
      __AUDIO_DAYS__: JSON.stringify(audio.advertised.days),
      __AUDIO_CHAPTERS__: JSON.stringify(audio.chapterFlags),
      __AUDIO_READINGS__: JSON.stringify(audio.advertised.readings),
      __DATA_VERSIONS__: JSON.stringify(versions),
      // Registered from production builds only (src/features/offline/register.ts).
      __SERVICE_WORKER__: JSON.stringify(command === "build"),
      __AI_ENABLED__: JSON.stringify(ai !== null),
      __AI_DAILY_CAP__: JSON.stringify(ai?.dailyCap ?? 0),
      __AI_ATTEMPT_CAP__: JSON.stringify(ai?.attemptCap ?? 0),
      __AI_CONFIG__: JSON.stringify(ai),
    },
  };
});
