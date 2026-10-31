import { defineConfig, devices } from "@playwright/test";
import {
  AI_KEY,
  AI_URL,
  APP_URL,
  PW_PORT,
  STUB_URL,
} from "./tests/browser/ai-stub";

const chromium = {
  ...devices["Pixel 5"],
  viewport: { width: 390, height: 844 },
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: process.env.CHROMIUM_PATH
      ? ["--no-sandbox", "--disable-dev-shm-usage"]
      : [],
  },
};

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: "list",
  use: {
    baseURL: APP_URL,
    reducedMotion: "reduce",
    // The offline worker would hide requests from page.route; only
    // offline.spec.ts allows it.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: /ai\.spec\.ts/, use: chromium },
    {
      name: "mobile-webkit",
      testIgnore: /ai\.spec\.ts/,
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 390, height: 844 },
      },
    },
    // The optional AI card, built into dist-ai/ against the local SSE stub.
    {
      name: "ai-chromium",
      testMatch: /ai\.spec\.ts/,
      use: { ...chromium, baseURL: AI_URL },
    },
  ],
  webServer: [
    {
      command: `npm start -- --host 127.0.0.1 --port ${PW_PORT} --strictPort`,
      url: APP_URL,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node scripts/sse-stub.mjs",
      env: { SSE_STUB_PORT: String(PW_PORT + 2) },
      url: `${STUB_URL}/__stub/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // `vite build` alone: public/readings and public/study come from the
      // regular build (npm run build), which runs first in CI.
      command: `npx vite build --outDir dist-ai --emptyOutDir --logLevel warn && npx vite preview --outDir dist-ai --host 127.0.0.1 --port ${PW_PORT + 1} --strictPort`,
      url: AI_URL,
      timeout: 180000,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_AI_PROVIDERS: "openrouter",
        VITE_OPENROUTER_API_KEY: AI_KEY,
        VITE_OPENROUTER_MODELS: "",
        VITE_OPENROUTER_BASE_URL: `${STUB_URL}/api/v1`,
        VITE_AI_ALLOW_LOCAL: "1",
        VITE_AI_DAILY_CAP: "",
      },
    },
  ],
});
