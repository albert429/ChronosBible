import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-ai",
      "public/readings",
      "public/study",
      "public/audio",
      "artifacts",
      // Local or Git-ignored work: concurrent checkouts, video projects,
      // Wrangler/Vercel output, Playwright MCP captures.
      "worktrees",
      ".claude/worktrees",
      ".agents",
      ".wrangler",
      ".vercel",
      ".playwright-mcp",
      "assets/video",
      "assets/reel*",
      "node_modules",
      "test-results",
      "playwright-report",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true },
      ],
      "no-control-regex": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["scripts/**", "hosting/**", "tests/**", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["scripts/quality/capture-preview.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
