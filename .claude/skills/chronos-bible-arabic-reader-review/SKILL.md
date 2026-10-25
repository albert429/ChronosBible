---
name: chronos-bible-arabic-reader-review
description: Review or verify chronosBible reader and navigation UI changes for Arabic RTL text, mobile widths, themes, focus, and reduced motion. Use after changing visible reader, plan, or navigation UI.
---

<!-- generated: scripts/agents/adapters.mjs | source: .agents/skills/chronos-bible-arabic-reader-review/ | files: SKILL.md | do not edit; run "npm run agents -- sync" after fixing canonical files -->

# Arabic reader review

Check the change as a reader on a phone would meet it. Prefer observing it in a browser over reading CSS.

## Checks

- **Widths:** 320, 390, and 430 px. No horizontal scroll, clipped controls, or toolbar overlapping Scripture.
- **Arabic text:** RTL flow, the largest font-size setting, long references and day labels wrapping cleanly, numerals and punctuation not reordered. Scripture stays readable and is never hidden behind chrome.
- **Themes:** light and dark, including icons, borders, and focus rings; contrast stays legible.
- **Keyboard and focus:** reachable in a sensible order, visible focus, dialogs return focus on close, `Escape` closes sheets.
- **Motion:** animations use transform and opacity and stop under `prefers-reduced-motion`.
- **State differences** (done, today, overdue) must not rely on colour alone.

## Evidence

Use the existing tooling: `tests/browser/` Playwright specs (with axe) and the visual capture script. With `PW_PORT` set to your assigned port, build and start your preview:

```sh
npm run build
npm start -- --host 127.0.0.1 --port "$PW_PORT" --strictPort
```

In another terminal in the same worktree, set `PW_PORT` to that assigned port and run:

```sh
PREVIEW_URL="http://127.0.0.1:$PW_PORT" npm run test:visual
```

The capture script reads `PREVIEW_URL`; setting `PW_PORT` alone does not select its target. It writes screenshots to the worktree's `artifacts/screenshots/` and metrics to `artifacts/preview-report.json`. Copy the evidence you need into the primary checkout's shared `.agents/artifacts/<task-id>/` before handoff, and cite those shared paths. Capture any required widths or states that the script does not cover separately.

Add or extend a browser spec only for behaviour that could regress; a purely cosmetic tweak does not need a new test.

Report each defect with the width or theme where it appears. Fix it only if the assignment allows UI edits; otherwise hand it to the ui-ux role.
