# bible150-ai-study

Own the study panel and optional AI: `src/study/`, `src/ai/`, `scripts/import-study.py`, `scripts/build-study.js`, `scripts/check-ai-models.mjs`.

- AI stays off by default; with `VITE_AI_PROVIDERS` unset the build contains no AI code or text.
- `VITE_*` values are public; never place real keys in files, tests, or logs.
- Accept only zero-priced `:free` models; keep the per-device daily cap.
- Cover changes with `tests/ai-*.test.ts` and the AI Playwright specs, using the stub, not live providers.
