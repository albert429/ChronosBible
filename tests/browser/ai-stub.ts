// Shared by the Playwright configs and ai.spec.ts. The local Worker mock
// routes provider requests to scripts/quality/sse-stub.mjs, never to OpenRouter.
// PW_PORT (default 4173) moves all three servers (app, AI preview at +1, stub
// at +2) so several worktrees can run the browser suite at once.
export const PW_PORT = Number(process.env.PW_PORT || 4173);
export const APP_URL = `http://127.0.0.1:${PW_PORT}`;
export const AI_URL = `http://127.0.0.1:${PW_PORT + 1}`;
export const STUB_URL = `http://127.0.0.1:${PW_PORT + 2}`;
export const AI_KEY = "sk-or-v1-playwright-dummy-key";
