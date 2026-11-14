import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import boundaries from "./scripts/quality/import-boundaries.mjs";

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
    // The layering of src/ (see scripts/quality/import-boundaries.mjs). Build
    // and tool code is held to the same table from the other side.
    files: [
      "src/**/*.{ts,tsx}",
      "worker/**/*.ts",
      "scripts/**/*.{js,mjs,ts}",
      "vite.config.ts",
    ],
    ignores: ["**/tests/**"],
    plugins: { chronos: boundaries },
    rules: { "chronos/import-boundaries": "error" },
  },
  {
    // Domain and shared/lib stay free of the UI framework and Node.
    files: ["src/core/**", "src/features/*/domain/**", "src/shared/lib/**"],
    ignores: ["**/tests/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react/*", "react-dom", "react-dom/*"],
              message: "Domain and shared/lib are pure: no React.",
            },
            {
              group: ["lucide-react", "node:*", "vite", "vite/*"],
              message: "Domain and shared/lib are pure: no UI or Node modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "scripts/**",
      "hosting/**",
      "tests/**",
      "**/tests/**",
      "config/**",
      "*.config.{js,ts}",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["scripts/quality/capture-preview.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
