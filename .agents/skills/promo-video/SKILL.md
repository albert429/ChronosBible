---
name: promo-video
description: Make, revise, or render a ChronosBible promo or feature video with Remotion using the existing repository promo-video playbook. Defaults to an Arabic 9:16 Reel, 30–45 seconds, with a cover image; use landscape only when requested. Use for video production, scene revisions, renders, or promo quality checks, not ordinary app UI implementation.
---

# ChronosBible promo video

Read and follow the full body of
[the existing promo-video playbook](../../../.claude/agents/promo-video.md) before
starting. It is the shared source for scene design, real-UI reconstruction,
Remotion setup, portrait safe zones, Arabic typography, audio, rendering,
verification, and the final report. Keep that playbook as the single source rather
than copying it here. Its Claude-specific frontmatter does not configure Codex;
use the equivalent tools available in this session.

Read `AGENTS.md` and inspect the actual app before making feature claims. Reuse a
local ignored video project if present; a fresh checkout may not contain one.
Keep generated media and scratch output in the repo's ignored media/artifact
locations. Creating a video does not require changing or deploying the app.

## Current repository lookup

The playbook includes historical Bible150 examples. Current source, labels,
schemas, and the user's brief take precedence over those fallback examples:

- App identity/credits: `src/shared/lib/appInfo.ts` and the current README.
- Visual tokens/fonts: `src/shared/styles/tokens.css`, `src/assets/`, and adjacent
  component CSS under `src/features/` and `src/shared/ui/`.
- Reader/navigation/audio: `src/features/reader/`, `src/features/navigation/`,
  `src/features/audio/`, and composition in `src/app/`.
- Study/AI demos: `src/features/study/`, `src/features/ai/prompt.ts`, and
  `src/domain/study/types.ts`. Canonical study assets are under
  `public/study/v2/`, with chapter indexes and ranged word/translation resources;
  the old day-based study paths and seven-field Greek tuple are historical.
  Confirm Greek, Hebrew, or Aramaic labels and disclose sample AI answers.
- Source Scripture and attribution: `data/`, its provenance/license documents,
  and the documented generators in `scripts/data/`. If generated data is needed,
  use the normal generation/build workflow; do not invent text or hand-edit output.

Treat old render paths, browser executable paths, package versions, and previously
approved media excerpts as historical context. Inspect available tools and the
current project; confirm that any media permission applies to this task. A past
public artifact URL is a reference, not authorization to republish it.

Use the playbook's portrait-first review and measured render checks. Report which
visual, audio, and device checks actually ran, and retain its concise final format.
