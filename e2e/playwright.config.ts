import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const runDir = process.env.RUN_DIR ?? '/tmp/neutrino-e2e/default';

/**
 * `PERF=1` swaps the functional suite for the performance one — see
 * `perf/README.md` and `scripts/run-perf.sh`, which sets it.
 *
 * A swap rather than an extra project, because the two cannot usefully run in
 * the same invocation. The perf project needs `trace: 'off'` (tracing distorts
 * exactly what it measures), much longer timeouts, no retries, and it takes
 * long enough that adding it to every functional run would be its own reason
 * to stop running either. `--project` would not be enough: Playwright runs
 * every configured project by default, so the perf tests would be picked up by
 * a bare `pnpm exec playwright test`.
 */
const perfRun = process.env.PERF === '1';

const chromium = {
  name: 'chromium',
  testDir: './tests',
  use: { ...devices['Desktop Chrome'] },
};

const perf = {
  name: 'perf',
  testDir: './perf/scenarios',
  // A section is one test: it seeds its fixtures once, then runs every
  // scenario in the section, each a warm-up plus five repeats. Sheets is nine
  // of those over a 50 000-cell workbook. Generous on purpose — a perf test
  // that dies on a timeout throws away the whole section's measurements — and
  // still far below "stuck forever".
  timeout: 45 * 60_000,
  // Never. A retried perf test reports a different machine state than the one
  // that failed, and a flaky *timing* is a finding — see the CV quarantine in
  // `perf/fixtures/budgets.ts` — not something to paper over.
  retries: 0,
  // Playwright's default action timeout is *no timeout*, which in a section
  // that runs nine scenarios back to back means one bad selector consumes the
  // whole 45 minutes and throws away every measurement the section had already
  // taken. Bounded so a broken step fails in half a minute and the rest of the
  // section still reports.
  use: {
    ...devices['Desktop Chrome'],
    // Fixed, because a different viewport renders a different amount.
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
    trace: 'off' as const,
    video: 'off' as const,
    screenshot: 'off' as const,
  },
  expect: { timeout: 30_000 },
};

export default defineConfig({
  testDir: './tests',
  outputDir: path.join(runDir, 'playwright-artifacts'),

  // Run tests serially — all tests share a single Docker stack, and for the
  // perf project parallel workers on one machine contaminate every timing.
  workers: 1,
  fullyParallel: false,

  // Retry once on CI to handle transient flakiness
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(runDir, 'playwright-report'), open: 'never' }],
  ],

  use: {
    baseURL: 'http://localhost:9880',

    // Always record traces (useful for debugging failures)
    trace: 'on',

    // Screenshot only on failure
    screenshot: 'only-on-failure',

    // Record video on first retry
    video: 'on-first-retry',
  },

  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  projects: perfRun ? [perf] : [chromium],
});
