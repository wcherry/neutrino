/**
 * F3–F7. The cross-cutting scenarios: memory, crypto throughput, search.
 *
 * (F1 and F2, the delivery lane, are in `delivery.spec.ts` — they need no
 * fixture and run in seconds, so they are kept where they can be run alone.)
 *
 * The memory scenarios are the ones most worth reading sceptically. A JS heap
 * measurement is only meaningful after a forced collection, and even then it
 * is noisy; `heapUsed()` collects first, and the budgets here are ratios
 * rather than absolute byte counts for the same reason B1's is.
 *
 * F7 — the takeout import of a 2 GB archive — is deliberately not implemented.
 * See the note at the bottom.
 */

import { expect, test } from '../fixtures/perf';
import { signIn } from '../fixtures/session';
import { seedDoc, seedFiles, seedNotes, seedSheet } from '../fixtures/seed';
import { SCALE } from '../fixtures/env';
import { openDoc, typeSlowly, waitForFirstRow, waitForIdle } from '../fixtures/actions';

/** Navigations in the F3 sweep. */
const SWEEP_ROUTES = [
  '/drive',
  '/docs',
  '/sheets',
  '/slides',
  '/notes',
  '/photos',
  '/diagrams',
  '/drawing',
  '/calendar',
  '/drive',
];

/** Open/close cycles in F4. */
const LEAK_CYCLES = 10;

test.describe('F — cross-cutting', () => {
  test('F3–F5 Memory and crypto', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'xcut');
    await seedFiles(session, 'S');
    const doc = await seedDoc(session, 'M');
    await seedSheet(session, 'S');

    // ── F3 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'F3',
        title: `Heap growth across ${SWEEP_ROUTES.length * 2} navigations`,
        fixture: `S (${SCALE.files.S} files)`,
        budgets: { heapGrowthRatio: 1.2 },
      },
      async (s) => {
        await page.goto('/drive');
        await waitForFirstRow(page);
        await waitForIdle(page);
        const baseline = await s.heapUsed();

        for (let pass = 0; pass < 2; pass += 1) {
          for (const route of SWEEP_ROUTES) {
            await page.goto(route);
            await page.waitForTimeout(300);
          }
        }
        await page.goto('/drive');
        await waitForFirstRow(page);
        await waitForIdle(page);

        const after = await s.heapUsed();
        s.record('heapBaseline', baseline, 'bytes');
        s.record('heapAfterSweep', after, 'bytes');
        // A ratio, not a byte delta: the absolute heap depends on the machine
        // and the Chromium build, the growth across identical navigations does
        // not.
        s.record('heapGrowthRatio', baseline > 0 ? after / baseline : 0, 'ratio');
      },
    );

    // ── F4 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'F4',
        title: `Open and close a document ${LEAK_CYCLES} times`,
        fixture: `M (${SCALE.paragraphs.M} paragraphs)`,
        budgets: { heapPerCycle: 4 * 1024 * 1024 },
        repeats: 3,
      },
      async (s) => {
        await openDoc(page, doc.id);
        await waitForIdle(page);
        await page.goto('/docs');
        await waitForIdle(page);
        const before = await s.heapUsed();

        for (let i = 0; i < LEAK_CYCLES; i += 1) {
          await openDoc(page, doc.id);
          await page.goto('/docs');
          await page.waitForTimeout(200);
        }
        await waitForIdle(page);
        const after = await s.heapUsed();

        s.record('heapDelta', after - before, 'bytes');
        // Per cycle, so the number means the same thing if `LEAK_CYCLES`
        // changes. Flat is the property being asserted; a real leak shows as a
        // per-cycle cost that does not fall when the editor is torn down.
        s.record('heapPerCycle', (after - before) / LEAK_CYCLES, 'bytes');
      },
    );

    // ── F5 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'F5',
        title: 'Encrypt/decrypt throughput in the page, 1 MB and 16 MB',
        budgets: { maxBlock: 50 },
      },
      async (s) => {
        // Measured through the app's real upload path rather than by
        // benchmarking libsodium directly. The question §8 finding 5 asks is
        // not "how fast is the cipher" — it is "how long is the main thread
        // unavailable while a file is sealed", and only the app's own
        // `uploadDriveFile` answers that, with its `encryptFile` call, its
        // metadata sealing and its thumbnail work in the same task.
        //
        // Wall time would fold in the upload itself, so the metric is the
        // longest main-thread block observed while the upload runs. The bytes
        // are mostly zeros with a random head: an incompressible payload would
        // change the transfer time and not the encryption cost, which is
        // linear in length either way.
        let worstBlock = 0;

        for (const megabytes of [1, 16]) {
          await page.goto('/drive');
          await waitForFirstRow(page);
          await waitForIdle(page);
          await s.resetMetrics();

          await page.getByRole('button', { name: 'Create new item' }).click();
          await page.getByRole('menuitem', { name: 'Upload' }).click();
          const dialog = page.getByRole('dialog', { name: 'Upload files' });
          await expect(dialog).toBeVisible({ timeout: 30_000 });

          const dropZone = dialog.getByTestId('drop-zone');
          const transfer = await page.evaluateHandle((mb) => {
            const bytes = new Uint8Array(mb * 1024 * 1024);
            crypto.getRandomValues(bytes.subarray(0, 65_536));
            const dt = new DataTransfer();
            dt.items.add(
              new File([bytes], `perf-${mb}mb.bin`, { type: 'application/octet-stream' }),
            );
            return dt;
          }, megabytes);

          await s.time(`upload_${megabytes}mb`, async () => {
            await dropZone.dispatchEvent('drop', { dataTransfer: transfer });
            await expect(dialog.locator('[role="progressbar"]')).toHaveAttribute(
              'aria-valuenow',
              '100',
              { timeout: 180_000 },
            );
          });
          await page.getByRole('button', { name: 'Done' }).click();
          await expect(dialog).toBeHidden({ timeout: 30_000 });

          const longest = await page.evaluate(() => {
            const store = (window as unknown as {
              __perf?: { longTasks: { duration: number }[] };
            }).__perf;
            return (store?.longTasks ?? []).reduce((m, t) => Math.max(m, t.duration), 0);
          });
          s.record(`block_${megabytes}mb`, longest);
          worstBlock = Math.max(worstBlock, longest);
        }

        s.record('maxBlock', worstBlock);
      },
    );
  });

  test('F6 Search across a large corpus', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'search');
    await seedNotes(session, Math.min(200, SCALE.files.M));
    await seedFiles(session, 'M');

    await perf.scenario(
      {
        id: 'F6',
        title: 'Search the topbar across a large corpus',
        fixture: `M (${SCALE.files.M} files + notes)`,
        budgets: { firstResult: 300, inp: 300 },
      },
      async (s) => {
        await page.goto('/drive');
        await waitForFirstRow(page);
        await waitForIdle(page);
        await s.resetMetrics();

        const search = page.locator('header').getByRole('searchbox', { name: 'Search' });
        await search.click();

        // Typed character by character so each keystroke is its own
        // interaction — the index is queried client-side on every one of them,
        // which is what makes INP the metric that matters here rather than
        // the time to the first result alone.
        const start = Date.now();
        await typeSlowly(search, 'perf', 60);
        await expect(
          page.getByTestId('topbar-search-result').first().or(page.getByTestId('topbar-search-empty')),
        ).toBeVisible({ timeout: 60_000 });
        s.record('firstResult', Date.now() - start);

        await typeSlowly(search, '-file-000', 60);
        await page.waitForTimeout(500);
      },
    );
  });

  /**
   * F7 — takeout import of a 2 GB archive — is not implemented here, and the
   * omission is deliberate rather than an oversight.
   *
   * The property it protects is real and already protected: `archive.test.ts`
   * asserts that the zip.js import path streams rather than buffering, so peak
   * heap stays proportional to the largest entry and not to the archive. That
   * is a unit test over the import code, it runs in seconds, and it fails for
   * the right reason.
   *
   * Reproducing it here would mean generating and uploading a 2 GB fixture per
   * run — minutes of wall time and gigabytes of disk in a suite that has to
   * stay runnable — to re-assert what is already covered, with a heap
   * measurement that is noisier than the unit test's. If the import ever grows
   * a UI-side cost that `archive.test.ts` cannot see, this is where it should
   * be measured; until then, adding it would cost more than it tells us.
   */
});
