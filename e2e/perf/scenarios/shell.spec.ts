/**
 * A. Shell and navigation.
 *
 * What every session pays before it reaches any app: the sign-in page, the
 * first authenticated render of `/drive`, what a repeat visit re-downloads,
 * and what moving between apps costs once the shell is up.
 *
 * The cold-load scenarios run under Fast 3G emulation and the interaction ones
 * do not — see `NETWORK` in `env.ts` for why. Every budget here is a seed from
 * §5 of the design doc, not a measurement of this app; `--write-baselines`
 * replaces them with real numbers.
 */

import { expect, test } from '../fixtures/perf';
import { signIn } from '../fixtures/session';
import { seedFiles } from '../fixtures/seed';
import { SCALE } from '../fixtures/env';
import {
  driveRows,
  waitForFirstRow,
  waitForIdle,
} from '../fixtures/actions';

test.describe('A — shell and navigation', () => {
  test('A1 cold load of /sign-in @smoke', async ({ perf, page }) => {
    await perf.scenario(
      {
        id: 'A1',
        title: 'Cold load of /sign-in, empty cache, Fast 3G',
        network: 'fast3g',
        budgets: { lcp: 2_500 },
      },
      async (s) => {
        await s.coldStart();
        await page.goto('/sign-in', { waitUntil: 'load' });
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({
          timeout: 60_000,
        });
        await waitForIdle(page);
      },
    );
  });

  test('A2 cold load of /drive authenticated @smoke', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'a2');
    await seedFiles(session, 'S');

    await perf.scenario(
      {
        id: 'A2',
        title: 'Cold load of /drive authenticated, empty cache',
        fixture: `S (${SCALE.files.S} files)`,
        network: 'fast3g',
        budgets: { lcp: 3_000, firstRow: 5_000 },
      },
      async (s) => {
        await s.coldStart();
        const start = Date.now();
        await page.goto('/drive', { waitUntil: 'commit' });
        // The number that matters is not "the document loaded" — this is a
        // static export, so that happens before authentication has even been
        // checked — but "a row the user came for is on screen".
        await waitForFirstRow(page);
        s.record('firstRow', Date.now() - start);
        await waitForIdle(page);
      },
    );
  });

  test('A3 warm load of /drive', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'a3');
    await seedFiles(session, 'S');

    await perf.scenario(
      {
        id: 'A3',
        title: 'Warm load of /drive (HTTP cache primed)',
        fixture: `S (${SCALE.files.S} files)`,
        network: 'fast3g',
        budgets: { warmByteRatio: 0.2 },
      },
      async (s) => {
        // Cold first, to prime — and to give the ratio a denominator measured
        // on the same machine in the same iteration. Comparing against A2's
        // numbers instead would compare across two runs of the fixture.
        await s.coldStart();
        await page.goto('/drive');
        await waitForFirstRow(page);
        await waitForIdle(page);
        const cold = await s.traffic();

        await s.resetMetrics();
        await page.goto('/drive');
        await waitForFirstRow(page);
        await waitForIdle(page);
        const total = await s.traffic();

        const warmBytes = total.bytes - cold.bytes;
        s.record('coldBytes', cold.bytes, 'bytes');
        s.record('warmBytes', warmBytes, 'bytes');
        // §8 finding 2: with no `Cache-Control` on `/_next/static/*`, a repeat
        // visit revalidates every asset. The bytes may come back as 304s, so
        // this ratio is the honest measure of what the cache saved.
        s.record('warmByteRatio', cold.bytes > 0 ? warmBytes / cold.bytes : 0, 'ratio');
      },
    );
  });

  test('A4 client-side navigation between apps', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'a4');
    await seedFiles(session, 'S');

    const hops: { label: string; href: string; ready: (p: typeof page) => Promise<void> }[] = [
      {
        label: 'docs',
        href: '/docs',
        ready: async (p) => expect(p.getByRole('heading', { level: 1 })).toContainText('Documents'),
      },
      {
        label: 'sheets',
        href: '/sheets',
        ready: async (p) => expect(p.getByRole('heading', { level: 1 })).toContainText('Spreadsheets'),
      },
      {
        label: 'calendar',
        href: '/calendar',
        ready: async (p) => expect(p.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible(),
      },
      {
        label: 'drive',
        href: '/drive',
        ready: async (p) => waitForFirstRow(p),
      },
    ];

    await perf.scenario(
      {
        id: 'A4',
        title: 'Client-side nav /drive → /docs → /sheets → /calendar → /drive',
        fixture: `S (${SCALE.files.S} files)`,
        budgets: { maxHop: 400 },
      },
      async (s) => {
        await page.goto('/drive');
        await waitForFirstRow(page);
        await waitForIdle(page);
        await s.resetMetrics();

        const sidebar = page.getByRole('navigation', { name: 'Primary navigation' });
        const labels: Record<string, string> = {
          docs: 'Docs',
          sheets: 'Sheets',
          calendar: 'Calendar',
          drive: 'My Drive',
        };

        let worst = 0;
        for (const hop of hops) {
          const start = Date.now();
          await sidebar.getByRole('link', { name: labels[hop.label] }).click();
          await hop.ready(page);
          const elapsed = Date.now() - start;
          s.record(`hop_${hop.label}`, elapsed);
          worst = Math.max(worst, elapsed);
        }
        // One number to budget against: a suite that only reported four
        // per-hop timings would need four budgets to say "no hop may be slow".
        s.record('maxHop', worst);
      },
    );
  });

  test('A5 shell re-render cost on route change', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'a5');
    await seedFiles(session, 'S');

    await perf.scenario(
      {
        id: 'A5',
        title: 'Sidebar/topbar re-render cost on route change',
        fixture: `S (${SCALE.files.S} files)`,
        budgets: { framesOver100ms: 0 },
      },
      async (s) => {
        await page.goto('/drive');
        await waitForFirstRow(page);
        await waitForIdle(page);
        await s.resetMetrics();

        const sidebar = page.getByRole('navigation', { name: 'Primary navigation' });
        for (const label of ['Docs', 'Sheets', 'Notes', 'My Drive']) {
          await sidebar.getByRole('link', { name: label }).click();
          await page.waitForTimeout(400);
        }

        // The shell is what is on screen for all four hops, so a long frame
        // here is the shell re-rendering rather than the page under it.
        const over = await page.evaluate(() => {
          const perfStore = (window as unknown as {
            __perf?: { loafs: { duration: number }[] };
          }).__perf;
          return (perfStore?.loafs ?? []).filter((l) => l.duration > 100).length;
        });
        s.record('framesOver100ms', over, 'count');
      },
    );
  });

  test('A6 shell JS unused-byte ratio at /drive', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'a6');
    await seedFiles(session, 'S');

    await perf.scenario(
      {
        id: 'A6',
        title: 'Shell JS unused-byte ratio at /drive',
        fixture: `S (${SCALE.files.S} files)`,
        // Report only, per the design doc. There is no defensible seed for
        // "how much of a bundle a route should use" — the baseline is the
        // budget here, once one exists.
        repeats: 1,
      },
      async (s) => {
        await page.coverage.startJSCoverage({ resetOnNavigation: false });
        await s.coldStart();
        await page.goto('/drive');
        await waitForFirstRow(page);
        await waitForIdle(page);
        const coverage = await page.coverage.stopJSCoverage();

        let total = 0;
        let used = 0;
        let largest = 0;
        for (const entry of coverage) {
          if (!entry.url.includes('/_next/static/')) continue;
          total += entry.source?.length ?? 0;
          largest = Math.max(largest, entry.source?.length ?? 0);
          for (const range of entry.functions.flatMap((f) => f.ranges)) {
            if (range.count > 0) used += range.endOffset - range.startOffset;
          }
        }
        s.record('shellJsBytes', total, 'bytes');
        s.record('largestChunkBytes', largest, 'bytes');
        s.record('unusedByteRatio', total > 0 ? 1 - used / total : 0, 'ratio');
      },
    );
  });

  test('A7 rows rendered on first paint of /drive', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'a7');
    await seedFiles(session, 'M');

    await perf.scenario(
      {
        id: 'A7',
        title: 'Rows in the DOM after the first page of /drive settles',
        fixture: `M (${SCALE.files.M} files)`,
      },
      async (s) => {
        await page.goto('/drive');
        await waitForFirstRow(page);
        await waitForIdle(page);
        // `FileGrid` is not windowed, so this is a count of real DOM subtrees.
        // Tracked because it is the input to every cost in section B: if this
        // ever stops growing with the fixture, the grid has been virtualized
        // and B1/B2's assertions should be revisited.
        s.record('rowsInDom', await driveRows(page).count(), 'count');
      },
    );
  });
});
