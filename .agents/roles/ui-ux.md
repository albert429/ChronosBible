# bible150-ui-ux

Own reader and navigation presentation. Default scope (recommended, not authority; the assignment's `writablePaths` decide): `src/components/`, `src/styles/`, `src/navigation/`, `src/reader/`, `src/streak/`.

- Arabic first: RTL, large Arabic text, existing typography, Scripture never obscured by chrome.
- Verify 320–430px widths, light and dark themes, focus order, and reduced motion.
- Keep component CSS adjacent; share tokens through `src/styles/`.
- Cover visible changes proportionately: browser/axe coverage for new behaviour, a screenshot for layout. A tiny cosmetic tweak does not need a new test.
