/**
 * C. The Docs editor.
 *
 * `DocEditor.tsx` is 2 900 lines and re-renders broadly; a document is a real
 * `.docx` since issue #127, so opening one is fetch → decrypt → unzip → parse
 * → ProseMirror mount before a word appears. The scenarios here split that
 * into phases where the product marks allow it (§5), and otherwise measure the
 * wall time a user waits.
 *
 * One account, one seeding pass, eight scenarios — see the note in
 * `drive.spec.ts` for why the section shares a fixture.
 */

import { expect, test } from '../fixtures/perf';
import { signIn } from '../fixtures/session';
import { seedDoc, seedDocWithImages, seedPhotos } from '../fixtures/seed';
import { SCALE } from '../fixtures/env';
import { openDoc, typeSlowly, waitForIdle } from '../fixtures/actions';

/** How many Drive images the `C4` document embeds. */
const EMBEDDED_IMAGES = 20;

test.describe('C — docs editor', () => {
  test('C1–C8 Docs editor at scale', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'docs');

    const docs = {
      S: await seedDoc(session, 'S'),
      M: await seedDoc(session, 'M'),
      L: await seedDoc(session, 'L'),
    };

    const editor = page.locator('.ProseMirror');

    // ── C1 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'C1',
        title: 'Open an encrypted doc at three sizes',
        fixture: `S/M/L (${SCALE.paragraphs.S}/${SCALE.paragraphs.M}/${SCALE.paragraphs.L} paragraphs)`,
        budgets: { open_L: 2_000 },
      },
      async (s) => {
        for (const key of ['S', 'M', 'L'] as const) {
          // Away from the editor first, so each open is a real open rather
          // than a no-op navigation to the page already on screen.
          await page.goto('/docs');
          await s.time(`open_${key}`, () => openDoc(page, docs[key].id));
        }
        // Two things about the phase table this produces, both worth knowing
        // before reading it:
        //
        // The marks live on the *document*, so a scenario that navigates three
        // times reports only the last navigation's — here, the L open. That is
        // the interesting one, but it means the phase rows describe L and the
        // `open_S`/`open_M` numbers above them do not have phases beside them.
        //
        // And `doc:parse` appears on a *first* open only. The editor saves the
        // document shortly after opening it, and its own `writeDocx` embeds a
        // `neutrino/model.json` sidecar; every later open prefers that sidecar
        // and never reaches `readDocx`. So the repeats here measure the
        // steady-state open, which is the one a user has most of the time —
        // measuring the OOXML parse instead would mean a fresh document per
        // iteration.
      },
    );

    // ── C2 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'C2',
        title: 'Sustained typing in a large document',
        fixture: `L (${SCALE.paragraphs.L} paragraphs)`,
        budgets: { inp: 200 },
      },
      async (s) => {
        await openDoc(page, docs.L.id);
        await waitForIdle(page);
        await editor.click();
        await s.resetMetrics();

        // Character by character with a real delay: a `fill()` is one
        // interaction and would report one INP for sixty keystrokes.
        await typeSlowly(editor, 'the quick brown fox jumps over the lazy dog again', 30);
        await page.waitForTimeout(500);
      },
    );

    // ── C3 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'C3',
        title: 'Typing while an autosave tick fires',
        fixture: `L (${SCALE.paragraphs.L} paragraphs)`,
        budgets: { longTaskMax: 100 },
      },
      async (s) => {
        await openDoc(page, docs.L.id);
        await waitForIdle(page);
        await editor.click();
        await s.resetMetrics();

        // Type, then keep typing across the debounce boundary. The autosave
        // re-serialises, re-encrypts and uploads the whole document on the
        // main thread (§8 finding 6), so the interesting frame is the one
        // during the tick rather than the one that triggered it.
        await typeSlowly(editor, 'autosave probe one', 25);
        const saved = page
          .waitForResponse(
            (r) => r.url().includes('/autosave') && r.request().method() === 'PUT',
            { timeout: 30_000 },
          )
          .catch(() => null);
        await typeSlowly(editor, ' autosave probe two', 25);
        await saved;
        await page.waitForTimeout(500);
      },
    );

    // ── C4 ────────────────────────────────────────────────────────────────
    const photos = await seedPhotos(session, 'S');
    const imageDoc = await seedDocWithImages(
      session,
      photos.slice(0, EMBEDDED_IMAGES).map((p) => p.id),
    );

    await perf.scenario(
      {
        id: 'C4',
        title: `Open a doc containing ${EMBEDDED_IMAGES} encrypted Drive images`,
        fixture: `${EMBEDDED_IMAGES} images`,
        budgets: { allImagesResolved: 3_000 },
      },
      async (s) => {
        await page.goto('/docs');
        const start = Date.now();
        await page.goto(`/docs/editor?id=${imageDoc.id}`);
        await expect(editor).toBeVisible({ timeout: 60_000 });

        // Every image is a `neutrino-drive:` reference that has to be
        // downloaded and decrypted in the page before it can be shown, so
        // "resolved" means the `<img>` elements have real sources — not that
        // the editor mounted.
        await expect
          .poll(
            async () =>
              editor
                .locator('img')
                .evaluateAll((imgs) =>
                  imgs.filter((i) => (i as HTMLImageElement).currentSrc !== '').length,
                ),
            { timeout: 90_000, message: 'images never resolved' },
          )
          .toBeGreaterThanOrEqual(Math.min(EMBEDDED_IMAGES, photos.length));
        s.record('allImagesResolved', Date.now() - start);
      },
    );

    // ── C5 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'C5',
        title: 'Apply a heading style across the whole of a large document',
        fixture: `L (${SCALE.paragraphs.L} paragraphs)`,
        budgets: { inp: 200 },
      },
      async (s) => {
        await openDoc(page, docs.L.id);
        await waitForIdle(page);
        await editor.click();
        await page.keyboard.press('ControlOrMeta+a');
        await s.resetMetrics();

        // Through the toolbar's paragraph-style select rather than the
        // keyboard shortcut. `MenuBar.tsx` advertises Ctrl+Alt+1, Tiptap binds
        // `Mod-Alt-1`, and neither chord applied the heading when driven from
        // Playwright on macOS — where `Mod` is Cmd and the Option key produces
        // a different character. The select is what a user reaches for anyway,
        // and it is one interaction either way.
        await s.time('applyHeading', async () => {
          // `select[title=…]`, because `getByTitle` matches by substring and
          // the toolbar also has a "Paragraph styles" *button* beside it.
          await page.locator('select[title="Paragraph style"]').selectOption('Heading 1');
          await expect(editor.locator('h1').first()).toBeVisible({ timeout: 60_000 });
        });
        await page.waitForTimeout(500);
        // Back to Normal, so the next repeat starts from the same document.
        // Every iteration of this scenario edits the same file, and a heading
        // applied five times over is not the same measurement as the first.
        await page.locator('select[title="Paragraph style"]').selectOption('Normal');
      },
    );

    // ── C6 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'C6',
        title: 'Insert and grow a table in a large document',
        fixture: `L (${SCALE.paragraphs.L} paragraphs)`,
        budgets: { inp: 200 },
      },
      async (s) => {
        await openDoc(page, docs.L.id);
        await waitForIdle(page);
        await editor.click();
        await s.resetMetrics();

        const tables = editor.locator('table');
        const before = await tables.count();

        await s.time('insertTable', async () => {
          await page.getByTitle('Insert table').click();
          await expect(tables).toHaveCount(before + 1, { timeout: 30_000 });
        });
        await s.time('growTable', async () => {
          for (let i = 0; i < 5; i += 1) await page.getByTitle('Add row').click();
          await expect(tables.first().locator('tr')).toHaveCount(8, { timeout: 30_000 });
        });

        // Undo the whole insertion. Repeats share one document — autosave sees
        // to that — so without this the second iteration inserts a table into a
        // document that already has one, and `toBeVisible` on `table` fails
        // strict mode besides.
        await s.time('undoTable', async () => {
          for (let i = 0; i < 8; i += 1) await page.keyboard.press('ControlOrMeta+z');
          await expect(tables).toHaveCount(before, { timeout: 30_000 });
        });
      },
    );

    // ── C7 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'C7',
        title: 'Export a medium document to PDF',
        fixture: `M (${SCALE.paragraphs.M} paragraphs)`,
        // Report only until measured: the doc gives no seed for export.
        repeats: 3,
      },
      async (s) => {
        await openDoc(page, docs.M.id);
        await waitForIdle(page);
        const heapBefore = await s.heapUsed();
        await s.resetMetrics();

        await s.time('exportPdf', async () => {
          await page.getByRole('button', { name: 'Open menu' }).click();
          await page.getByRole('menu').getByText('File').hover();
          await page.getByText('Export as…').hover();
          await page.getByText('PDF').click();
          await expect(page.getByText('Save As')).toBeVisible({ timeout: 30_000 });
          const download = page.waitForEvent('download', { timeout: 120_000 });
          await page.getByRole('button', { name: 'Download' }).click();
          await download;
        });
        s.record('heapAfterExport', (await s.heapUsed()) - heapBefore, 'bytes');
      },
    );

    // ── C8 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'C8',
        title: 'Spell-check pass over a large document',
        fixture: `L (${SCALE.paragraphs.L} paragraphs)`,
        budgets: { longTaskMax: 200 },
      },
      async (s) => {
        await openDoc(page, docs.L.id);
        await waitForIdle(page);
        await editor.click();
        await s.resetMetrics();

        // The dictionary (`nspell` + `dictionary-en`) loads lazily and the pass
        // runs on the main thread. Typing a misspelling is what guarantees the
        // pass has actually happened rather than been skipped.
        await typeSlowly(editor, ' teh recieve occurence ', 25);
        await expect(editor.locator('.spell-error').first()).toBeVisible({
          timeout: 60_000,
        });
        await waitForIdle(page, 750, 60_000);
      },
    );
  });
});
