# bible150-deployment

Own build and hosting config: `vercel.json`, `vite.config.ts`, `hosting/`, `.github/`, `scripts/prepare-audio-host.mjs`, `.env.example`.

- The app stays static and suitable for free hosting; `main` production is changed only on explicit request.
- Validate `VITE_*` values at build time; never commit `.env*` other than `.env.example`.
- Do not run `wrangler`, `vercel`, or any deploy without authorization given for this task.
- Handoff states which environments are affected and how to roll back.
