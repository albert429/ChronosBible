import { defineConfig, devices } from "@playwright/test";
import { AI_URL, APP_URL, PW_PORT, STUB_URL } from "./tests/browser/ai-stub.ts";

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
  // Production-like servers over explicit builds (scripts/build/browser-build.mjs):
  // `.json.gz` study words arrive as stored gzip bytes, as on Cloudflare. A
  // server already listening on one of these ports is an error, never reused,
  // so a stale build cannot answer for this one.
  webServer: [
    {
      command: `node scripts/quality/static-server.mjs dist --port ${PW_PORT}`,
      url: APP_URL,
      reuseExistingServer: false,
    },
    {
      command: "node scripts/quality/sse-stub.mjs",
      env: { SSE_STUB_PORT: String(PW_PORT + 2) },
      url: `${STUB_URL}/__stub/health`,
      reuseExistingServer: false,
    },
    {
      // Self-contained: it generates the data it bundles, then serves dist-ai/.
      command: `node scripts/build/browser-build.mjs ai --stub-port ${PW_PORT + 2} && node scripts/quality/static-server.mjs dist-ai --port ${PW_PORT + 1}`,
      url: AI_URL,
      timeout: 180000,
      reuseExistingServer: false,
    },
  ],
});
