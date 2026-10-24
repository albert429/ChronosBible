---
name: chronos-bible-arabic-reader-review
description: Review or verify chronosBible reader and navigation UI changes for Arabic RTL text, mobile widths, themes, focus, and reduced motion. Use after changing visible reader, plan, or navigation UI.
---

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

Use the existing tooling: `tests/browser/` Playwright specs (with axe) and `npm run test:visual` against a running preview on your own `PW_PORT`. Save screenshots under the shared `.agents/artifacts/` and cite them in the handoff. Add or extend a browser spec only for behaviour that could regress; a purely cosmetic tweak does not need a new test.

Report each defect with the width or theme where it appears. Fix it only if the assignment allows UI edits; otherwise hand it to the ui-ux role.
