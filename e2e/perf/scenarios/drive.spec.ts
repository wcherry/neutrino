/**
 * B. Drive and file listings — the prime suspect.
 *
 * `FileGrid` renders every row it has been given. There is no windowing:
 * `loading="lazy"` on the thumbnails defers image bytes, and nothing defers the
 * DOM nodes or the React work. §8 finding 3.
 *
 * Two things about how `/drive` actually behaves shape every scenario here,
 * and both were found by reading `drive/page.tsx` rather than assumed:
 *
 *  1. The listing pages 200 at a time (`CONTENTS_PAGE_SIZE`) and appends on an
 *     IntersectionObserver at the foot of the list. So the cost of a large
 *     account does not arrive on load — it arrives as the user scrolls, onto a
 *     list that is never trimmed. `loadAllDriveRows` is what drives that.
 *  2. Folder navigation is `useState`, not a route. A folder cannot be
 *     deep-linked, so the size comparison in B1 is done by clicking into three
 *     folders rather than by loading three URLs — which is the better
 *     measurement anyway, because it isolates grid rendering from page load.
 *
 * All six scenarios share one account and one seeding pass. Seeding an L
 * fixture is minutes of uploads; paying that six times over would make the
 * section unrunnable, and the scenarios do not interfere with each other.
 */

import { expect, test } from '../fixtures/perf';
import { signIn } from '../fixtures/session';
import { seedFiles, seedFolder } from '../fixtures/seed';
import { SCALE } from '../fixtures/env';
import {
  driveRows,
  filesSection,
  loadAllDriveRows,
  openRowMenu,
  scrollThrough,
  switchView,
  toggleFilterChip,
  waitForFirstRow,
  waitForIdle,
} from '../fixtures/actions';

test.describe('B — drive and file listings', () => {
  test('B1–B6 Drive listing at scale', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'drive');

    // Three folders in one account, so B1 can compare sizes without three
    // sign-ins and three seeding passes.
    const folders: Record<'S' | 'M' | 'L', { name: string; id: string; count: number }> = {
      S: { name: 'perf-S', id: '', count: SCALE.files.S },
      M: { name: 'perf-M', id: '', count: SCALE.files.M },
      L: { name: 'perf-L', id: '', count: SCALE.files.L },
    };
    for (const key of ['S', 'M', 'L'] as const) {
      folders[key].id = await seedFolder(session, folders[key].name);
      await seedFiles(session, key, {
        folderId: folders[key].id,
        prefix: `perf-${key.toLowerCase()}`,
      });
    }

    /** Open `/drive`, click into a folder, and render everything in it. */
    const openFolder = async (key: 'S' | 'M' | 'L'): Promise<number> => {
      await page.goto('/drive');
      await waitForFirstRow(page);
      await filesSection(page)
        .getByRole('listitem', { name: folders[key].name })
        .first()
        .click();
      return loadAllDriveRows(page, folders[key].count);
    };

    // ── B1 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'B1',
        title: 'Render every row of a folder at three sizes',
        fixture: `S/M/L (${SCALE.files.S}/${SCALE.files.M}/${SCALE.files.L} files)`,
        // The design doc's budget is a *shape*, not a time: 5 000 files may
        // take no more than 3× what 100 takes. That is the assertion that
        // actually tests the hypothesis, and unlike an absolute millisecond
        // budget it survives being run on a different machine.
        budgets: { growthRatio: 3 },
      },
      async (s) => {
        const times: Record<string, number> = {};
        for (const key of ['S', 'M', 'L'] as const) {
          const start = Date.now();
          const rendered = await openFolder(key);
          times[key] = Date.now() - start;
          s.record(`render_${key}`, times[key]);
          s.record(`rows_${key}`, rendered, 'count');
        }
        s.record('growthRatio', times.S > 0 ? times.L / times.S : 0, 'ratio');
      },
    );

    // ── B2 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'B2',
        title: 'Scroll the fully-loaded L listing at a fixed rate',
        fixture: `L (${SCALE.files.L} files)`,
        budgets: { scrollDroppedRatio: 0.1 },
      },
      async (s) => {
        await openFolder('L');
        await waitForIdle(page);
        await s.resetMetrics();
        // Back to the top, so every repeat scrolls the same rows.
        await page.evaluate(() => {
          document.querySelector('[data-perf-scroller="1"]')?.scrollTo({ top: 0 });
        });
        await s.frameRate('scroll', () =>
          scrollThrough(page, '[aria-labelledby="all-files-heading"]', {
            distance: 12_000,
            step: 60,
          }),
        );
      },
    );

    // ── B3 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'B3',
        title: 'Switch view Large grid → Small grid → Detailed list on L',
        fixture: `L (${SCALE.files.L} files)`,
        budgets: { inp: 200 },
      },
      async (s) => {
        await openFolder('L');
        await waitForIdle(page);
        await s.resetMetrics();

        for (const mode of ['Small grid', 'Detailed list', 'Large grid'] as const) {
          await s.time(`switch_${mode.split(' ')[0].toLowerCase()}`, async () => {
            await switchView(page, mode);
            await expect(driveRows(page).first()).toBeVisible({ timeout: 30_000 });
          });
        }
      },
    );

    // ── B4 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'B4',
        title: 'Sort and filter-chip toggle on the L listing',
        fixture: `L (${SCALE.files.L} files)`,
        budgets: { inp: 200 },
      },
      async (s) => {
        await openFolder('L');
        await waitForIdle(page);
        await s.resetMetrics();

        // Sorting re-queries the server; the filter chip is the purely
        // client-side path over every loaded row, which is the one §8 is
        // suspicious of.
        await s.time('sortByName', async () => {
          await filesSection(page).getByText('Name', { exact: true }).click();
          await expect(driveRows(page).first()).toBeVisible({ timeout: 30_000 });
        });
        await s.time('filterChip', async () => {
          await toggleFilterChip(page, 'Office');
          await page.waitForTimeout(100);
          await toggleFilterChip(page, 'All');
          await expect(driveRows(page).first()).toBeVisible({ timeout: 30_000 });
        });
      },
    );

    // ── B5 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'B5',
        title: 'Open the row context menu on the L listing',
        fixture: `L (${SCALE.files.L} files)`,
        budgets: { inp: 100 },
      },
      async (s) => {
        await openFolder('L');
        await waitForIdle(page);
        await s.resetMetrics();

        // A row near the end, so the menu opens against a fully-grown DOM
        // rather than the first screenful.
        const name = `perf-l-${String(SCALE.files.L - 1).padStart(5, '0')}.txt`;
        await s.time('menuOpen', () => openRowMenu(page, name));
        await page.keyboard.press('Escape');
      },
    );

    // ── B6 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'B6',
        title: 'Thumbnail request storm in the first two seconds of the L listing',
        fixture: `L (${SCALE.files.L} files)`,
        // Report only until a baseline exists — the doc has no defensible seed
        // for "how many image requests are too many".
      },
      async (s) => {
        await page.goto('/drive');
        await waitForFirstRow(page);
        await s.resetMetrics();
        const before = await s.traffic();

        await filesSection(page)
          .getByRole('listitem', { name: folders.L.name })
          .first()
          .click();
        await waitForFirstRow(page);
        await page.waitForTimeout(2_000);

        const after = await s.traffic();
        s.record('imageRequestsIn2s', after.imageRequests - before.imageRequests, 'count');
        s.record('apiRequestsIn2s', after.apiRequests - before.apiRequests, 'count');
        s.record('bytesIn2s', after.bytes - before.bytes, 'bytes');
      },
    );
  });
});
