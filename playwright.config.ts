import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 4471);
// Anything the tests start (CLI exports, servers) keeps its shared recent list in a temp folder,
// never the user's ~/.config/storyboard-viewer (the e2e servers get their own in serve.mjs).
process.env['SBD_CONFIG_DIR'] ??= fileURLToPath(new URL('e2e/.tmp/config-misc', import.meta.url));
/** Second server (own copy of the example) for the editing tests. */
export const EDIT_PORT = PORT + 1;
/** Static copy of the built app without `sbd serve` (like the hosted copy), hosted tests. */
export const HOSTED_PORT = PORT + 2;
/** Static server that swaps between two builds of the app (e2e/updates.spec.ts). */
export const UPDATE_PORT = PORT + 3;

/**
 * Every test starts as a returning user: the first-run tour offer and the canvas hint strip are
 * already dismissed (tests for them use a fresh context, see e2e/tours.spec.ts).
 */
const RETURNING = [
  { name: 'sbd:tour-offered', value: '1' },
  { name: 'sbd:canvas-hint-done', value: 'true' },
];
export const returningUser = {
  cookies: [],
  origins: [PORT, EDIT_PORT, HOSTED_PORT, UPDATE_PORT].map((p) => ({
    origin: `http://localhost:${p}`,
    localStorage: RETURNING,
  })),
};

// E2E tests run the built CLI (`pnpm build` first): `sbd serve` on a temp copy of
// examples/minimal.sbd, opened in Chromium; plus apps/web/dist on a plain static server.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 860 },
    storageState: returningUser,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 860 },
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
  webServer: [
    {
      command: `node e2e/serve.mjs ${PORT}`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `node e2e/serve.mjs ${EDIT_PORT} edit`,
      url: `http://localhost:${EDIT_PORT}/api/health`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `node e2e/static.mjs ${HOSTED_PORT}`,
      url: `http://localhost:${HOSTED_PORT}/`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // builds a second copy of the app first ("version B")
      command: `node e2e/static.mjs ${UPDATE_PORT} --updates`,
      url: `http://localhost:${UPDATE_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
