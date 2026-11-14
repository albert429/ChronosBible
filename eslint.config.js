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
      "no-restricted-globals": [
        "error",
        {
          checkGlobalObject: true,
          globals: [
            "window",
            "document",
            "navigator",
            "location",
            "history",
            "self",
            "localStorage",
            "sessionStorage",
            "indexedDB",
            "caches",
            "fetch",
            "XMLHttpRequest",
            "WebSocket",
            "EventSource",
            "Worker",
            "SharedWorker",
            "ServiceWorker",
            "BroadcastChannel",
            "setTimeout",
            "setInterval",
            "requestAnimationFrame",
            "cancelAnimationFrame",
            "requestIdleCallback",
            "performance",
            "matchMedia",
            "MutationObserver",
            "ResizeObserver",
            "IntersectionObserver",
            "Audio",
            "AudioContext",
            "Notification",
          ].map((name) => ({
            name,
            message:
              "Pure modules receive browser state and effects as inputs.",
          })),
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Pure modules receive the current date as an input.",
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: "Pure modules receive the current date as an input.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message: "Pure modules receive the current time as an input.",
        },
      ],
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
