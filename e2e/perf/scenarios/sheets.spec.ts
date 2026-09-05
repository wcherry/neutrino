/**
 * D. Sheets.
 *
 * The one editor whose grid *is* virtualized — `computeViewport`/`lowerBound`
 * in `SheetGrid.tsx`. That makes D1 and D2 assertions about a property worth
 * keeping rather than a problem to find: open time should be roughly flat in
 * the number of cells, and scrolling should not drop frames however large the
 * sheet is. If either stops being true, windowing has been lost.
 *
 * The rest of the section is where the cost that *isn't* windowed lives: the
 * formula graph, a paste that touches thousands of cells, a structural row
 * insert, and the autosave that re-serialises and re-encrypts the workbook.
 */

import { expect, test } from '../fixtures/perf';
import { signIn } from '../fixtures/session';
import { seedSheet } from '../fixtures/seed';
import { SCALE } from '../fixtures/env';
import {
  openSheet,
  scrollAcross,
  scrollThrough,
  setCell,
  waitForIdle,
} from '../fixtures/actions';

/** Rows of formulas in the L fixture, each column summing the literals above. */
const FORMULA_ROWS = 20;

test.describe('D — sheets', () => {
  test('D1–D9 Sheets at scale', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'sheets');

    const sheets = {
      S: await seedSheet(session, 'S'),
      M: await seedSheet(session, 'M'),
      // The formula tail is what D3 edits into: 20 rows × 20 columns of SUMs
      // over the literals above them, so one cell edit invalidates hundreds.
      L: await seedSheet(session, 'L', { formulaRows: FORMULA_ROWS }),
    };

    const gridAnchor = '[data-type="cell"][id="A1"]';

    // ── D1 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'D1',
        title: 'Open a sheet at three sizes',
        fixture: `S/M/L (${SCALE.cells.S}/${SCALE.cells.M}/${SCALE.cells.L} cells)`,
        // Flat-ish, because the grid is windowed: the L sheet may take at most
        // twice what S takes. A number that fails here means either the
        // windowing is gone or the *parse* — which is not windowed — has
        // become the dominant cost.
        budgets: { openRatio: 2 },
      },
      async (s) => {
        const times: Record<string, number> = {};
        for (const key of ['S', 'M', 'L'] as const) {
          await page.goto('/sheets');
          times[key] = 0;
          const start = Date.now();
          await openSheet(page, sheets[key].id);
          times[key] = Date.now() - start;
          s.record(`open_${key}`, times[key]);
        }
        s.record('openRatio', times.S > 0 ? times.L / times.S : 0, 'ratio');
      },
    );

    // ── D2 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'D2',
        title: 'Scroll vertically and horizontally on the L sheet',
        fixture: `L (${SCALE.cells.L} cells)`,
        budgets: { scrollDownDroppedRatio: 0.1, scrollAcrossDroppedRatio: 0.1 },
      },
      async (s) => {
        await openSheet(page, sheets.L.id);
        await waitForIdle(page);
        await s.resetMetrics();

        await s.frameRate('scrollDown', () =>
          scrollThrough(page, gridAnchor, { distance: 6_000, step: 50 }),
        );
        await s.frameRate('scrollAcross', () =>
          scrollAcross(page, gridAnchor, { distance: 4_000, step: 50 }),
        );
      },
    );

    // ── D3 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'D3',
        title: 'Edit one cell that hundreds of formulas depend on',
        fixture: `L (${SCALE.cells.L} cells, ${FORMULA_ROWS} formula rows)`,
        budgets: { inp: 300, recalc: 300 },
      },
      async (s) => {
        await openSheet(page, sheets.L.id);
        await waitForIdle(page);
        await s.resetMetrics();

        // B2 is inside every `SUM(B2:B…)` in the formula tail, so committing a
        // value here is what forces the dependency walk.
        await s.time('recalc', async () => {
          await setCell(page, 'B2', String(Date.now() % 1000));
          await expect(page.locator('[data-type="cell"][id="B2"] span')).not.toHaveText('', {
            timeout: 30_000,
          });
        });
        await page.waitForTimeout(500);
      },
    );

    // ── D4 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'D4',
        title: 'Paste a 1 000 × 20 block',
        fixture: `M (${SCALE.cells.M} cells)`,
        budgets: { paste: 1_500 },
      },
      async (s) => {
        await openSheet(page, sheets.M.id);
        await waitForIdle(page);
        await s.resetMetrics();

        // TSV on the clipboard is what a paste from another spreadsheet
        // actually is, and it goes through the same parse-and-apply path.
        const block = Array.from({ length: 1_000 }, (_, r) =>
          Array.from({ length: 20 }, (_, c) => r * 20 + c).join('\t'),
        ).join('\n');
        await page.evaluate(async (text) => {
          await navigator.clipboard.writeText(text);
        }, block);

        await page.locator('[data-type="cell"][id="A1"]').click();
        await s.time('paste', async () => {
          await page.keyboard.press('ControlOrMeta+v');
          await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText('0', {
            timeout: 60_000,
          });
        });
      },
    );

    // ── D5 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'D5',
        title: 'Apply conditional formatting across the L sheet',
        fixture: `L (${SCALE.cells.L} cells)`,
        budgets: { applyRule: 500 },
      },
      async (s) => {
        await openSheet(page, sheets.L.id);
        await waitForIdle(page);

        // Select before opening the panel: a new rule takes the current
        // selection as its range, so a rule added with one cell selected is
        // applied to one cell and measures nothing.
        await page.locator('[data-type="cell"][id="A1"]').click();
        await page.keyboard.press('ControlOrMeta+a');
        await s.resetMetrics();

        // `ConditionalFormattingDialog` is a bare `<div>` overlay with no
        // `role`, so it is found by its own header text rather than by role —
        // `getByRole('dialog')` matches nothing here and waits out its timeout.
        const panel = page.getByText('Conditional formatting', { exact: true });
        await s.time('applyRule', async () => {
          await page.getByTitle('Conditional formatting').click();
          await expect(panel).toBeVisible({ timeout: 30_000 });
          await page.getByRole('button', { name: 'Add rule' }).click();
          await page.getByRole('button', { name: 'Done' }).click();
          await expect(panel).toBeHidden({ timeout: 60_000 });
        });
        // Rules are evaluated per visible cell on every scroll, so the cost
        // that matters is the one *after* the rule exists.
        await s.frameRate('scrollAfterRule', () =>
          scrollThrough(page, gridAnchor, { distance: 3_000, step: 50 }),
        );
      },
    );

    // ── D6 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'D6',
        title: 'Insert and delete a row on the L sheet',
        fixture: `L (${SCALE.cells.L} cells)`,
        budgets: { inp: 300 },
      },
      async (s) => {
        await openSheet(page, sheets.L.id);
        await waitForIdle(page);
        await s.resetMetrics();

        // A structural shift: every row below moves, and every formula
        // referencing them has to be rewritten.
        await s.time('insertRow', async () => {
          await page.locator('[data-type="cell"][id="A5"]').click({ button: 'right' });
          await expect(page.getByRole('menu', { name: 'Cell options' })).toBeVisible({
            timeout: 30_000,
          });
          await page.getByRole('menuitem', { name: 'Insert row above' }).click();
          await expect(page.getByRole('menu', { name: 'Cell options' })).toBeHidden({
            timeout: 30_000,
          });
        });
        await s.time('deleteRow', async () => {
          await page.locator('[data-type="cell"][id="A5"]').click({ button: 'right' });
          await expect(page.getByRole('menu', { name: 'Cell options' })).toBeVisible({
            timeout: 30_000,
          });
          await page.getByRole('menuitem', { name: 'Delete row' }).click();
          await expect(page.getByRole('menu', { name: 'Cell options' })).toBeHidden({
            timeout: 30_000,
          });
        });
      },
    );

    // ── D7 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'D7',
        title: 'Render a chart over a large range',
        fixture: `M (${SCALE.cells.M} cells)`,
        budgets: { chartPainted: 800 },
      },
      async (s) => {
        await openSheet(page, sheets.M.id);
        await waitForIdle(page);
        await s.resetMetrics();

        await s.time('chartPainted', async () => {
          await page.getByTitle('Insert Chart').click();
          await expect(page.getByText('Insert Chart', { exact: true }).first()).toBeVisible({
            timeout: 30_000,
          });
          await page.getByPlaceholder('e.g. A1:D10').fill('B2:E502');
          await page.getByTestId('insert-chart-submit').click();
          await expect(page.locator('[class*="chartFrame"]').first()).toBeVisible({
            timeout: 60_000,
          });
        });
      },
    );

    // ── D8 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'D8',
        title: 'Multi-select a run of row headers on the L sheet',
        fixture: `L (${SCALE.cells.L} cells)`,
        budgets: { inp: 200 },
      },
      async (s) => {
        await openSheet(page, sheets.L.id);
        await waitForIdle(page);
        await s.resetMetrics();

        // Shift-click across a run of headers — the selection path added in
        // 1920261, which has to reconcile a range rather than a single index.
        const headers = page.locator('[data-row-header]');
        const count = await headers.count();
        if (count >= 20) {
          await headers.nth(2).click();
          await s.time('multiSelect', async () => {
            await headers.nth(18).click({ modifiers: ['Shift'] });
            await page.waitForTimeout(50);
          });
        } else {
          // Fewer headers than the run needs means the viewport is smaller
          // than expected — recorded rather than silently measuring nothing.
          s.record('headersFound', count, 'count');
        }
      },
    );

    // ── D9 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'D9',
        title: 'Autosave an L sheet (serialise + encrypt + upload)',
        fixture: `L (${SCALE.cells.L} cells)`,
        budgets: { longTaskMax: 150 },
      },
      async (s) => {
        await openSheet(page, sheets.L.id);
        await waitForIdle(page);
        await s.resetMetrics();

        const saved = page
          .waitForResponse(
            (r) => r.url().includes('/autosave') && r.request().method() === 'PUT',
            { timeout: 60_000 },
          )
          .catch(() => null);
        await setCell(page, 'A1', `probe ${Date.now() % 1000}`);
        await s.time('autosaveRoundTrip', async () => {
          await saved;
        });
        await page.waitForTimeout(500);
      },
    );
  });
});
