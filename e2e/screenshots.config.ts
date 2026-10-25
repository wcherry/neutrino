import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The landing-page screenshot capture (`screenshots/landing.spec.ts`), kept out of the e2e suite:
 * it writes into the web app's `public/`, takes minutes, and asserts nothing about behaviour. It
 * shares the suite's disposable Docker stack, so it runs on the same `neutrino:test` image —
 * build it first (`cargo e2e` does) and run `pnpm screenshots` from `e2e/`.
 */
const runDir = process.env.RUN_DIR ?? `/tmp/neutrino-e2e/screenshots_${Date.now()}`;
process.env.RUN_DIR = runDir;
// What `global-setup.ts` makes only when it picks the run directory itself — the stack mounts these.
for (const sub of ['data/storage', 'service-logs', 'browser-logs', 'databases', 'playwright-results']) {
  fs.mkdirSync(path.join(runDir, sub), { recursive: true });
}

export default defineConfig({
  testDir: './screenshots',
  outputDir: path.join(runDir, 'playwright-artifacts'),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:9880',
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    trace: 'retain-on-failure',
    screenshot: 'off',
  },
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
});
