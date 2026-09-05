/**
 * E. Slides, diagrams, drawing and photos.
 *
 * Three different rendering models in one section, which is why they share a
 * file but not a fixture:
 *
 *  - **Slides** is React over absolutely-positioned elements, with a thumbnail
 *    rail that renders every slide in the deck.
 *  - **Diagrams** is SVG, not Konva. The design doc's §6 calls E4 "Konva",
 *    which is true of the Drawing app; `canvas-editing.spec.ts` and
 *    `DiagramCanvas` both work in `svg`, so E4 drags an SVG node and E4b
 *    covers the Konva canvas separately.
 *  - **Photos** is the second unvirtualized grid, and the one whose thumbnails
 *    are inlined into the listing response (issue #175) — so it is the
 *    scenario where payload and render cost arrive together.
 */

import { expect, test } from '../fixtures/perf';
import { signIn } from '../fixtures/session';
import {
  seedDeck,
  seedDiagram,
  seedDrawing,
  seedPhotos,
} from '../fixtures/seed';
import { SCALE } from '../fixtures/env';
import {
  openDiagram,
  openSlides,
  scrollThrough,
  waitForIdle,
  waitForSlideCount,
} from '../fixtures/actions';

/** Photo cards in the grid — CSS-module class names keep their source name. */
const PHOTO_GRID = '[class*="photoGrid"]';

test.describe('E — slides, diagrams and photos', () => {
  test('E1–E4 Slides and diagrams', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'slides');

    const deck = await seedDeck(session, 'L');
    const busySlide = await seedDeck(session, 'S', {
      elementsPerSlide: SCALE.slideElements.M,
    });
    const diagram = await seedDiagram(session, 'L');
    const drawing = await seedDrawing(session, SCALE.diagramNodes.L);

    // ── E1 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'E1',
        title: `Open a ${SCALE.slides.L}-slide deck`,
        fixture: `L (${SCALE.slides.L} slides)`,
        budgets: { openDeck: 2_500 },
      },
      async (s) => {
        await page.goto('/slides');
        await s.time('openDeck', () => openSlides(page, deck.id));
        // The thumbnail rail renders one tile per slide, so "editable" and
        // "rail painted" are different moments and the second is the one a
        // large deck pays for.
        await s.time('railPainted', () => waitForSlideCount(page, SCALE.slides.L));
      },
    );

    // ── E2 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'E2',
        title: 'Navigate between slides in a large deck',
        fixture: `L (${SCALE.slides.L} slides)`,
        budgets: { inp: 150 },
      },
      async (s) => {
        await openSlides(page, deck.id);
        await waitForIdle(page);
        await s.resetMetrics();

        // Arrow keys rather than clicking a thumbnail: the same slide change,
        // without also measuring a scroll of the rail.
        for (let i = 0; i < 8; i += 1) {
          await page.keyboard.press('PageDown');
          await page.waitForTimeout(120);
        }
      },
    );

    // ── E3 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'E3',
        title: `Drag an element on a slide holding ${SCALE.slideElements.M} elements`,
        fixture: `M (${SCALE.slideElements.M} elements)`,
        floors: { dragFps: 50 },
      },
      async (s) => {
        await openSlides(page, busySlide.id);
        await waitForIdle(page);
        await s.resetMetrics();

        const target = page.locator('text=Slide 1').first();
        await expect(target).toBeVisible({ timeout: 30_000 });
        const box = await target.boundingBox();
        expect(box, 'the slide element to drag must be on screen').toBeTruthy();

        await s.frameRate('drag', async () => {
          await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
          await page.mouse.down();
          for (let i = 1; i <= 30; i += 1) {
            await page.mouse.move(
              box!.x + box!.width / 2 + i * 6,
              box!.y + box!.height / 2 + i * 3,
            );
          }
          await page.mouse.up();
        });
      },
    );

    // ── E4 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'E4',
        title: `Drag a node in a ${SCALE.diagramNodes.L}-node SVG diagram`,
        fixture: `L (${SCALE.diagramNodes.L} nodes)`,
        floors: { dragFps: 50 },
      },
      async (s) => {
        await openDiagram(page, diagram.id);
        await waitForIdle(page);
        await s.resetMetrics();

        const node = page.locator('svg text').filter({ hasText: 'Node 1' }).first();
        await expect(node).toBeVisible({ timeout: 30_000 });
        const box = await node.boundingBox();
        expect(box, 'the diagram node to drag must be on screen').toBeTruthy();

        await s.frameRate('drag', async () => {
          await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
          await page.mouse.down();
          for (let i = 1; i <= 30; i += 1) {
            await page.mouse.move(
              box!.x + box!.width / 2 + i * 8,
              box!.y + box!.height / 2 + i * 4,
            );
          }
          await page.mouse.up();
        });
      },
    );

    // ── E4b ───────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'E4b',
        title: 'Open and pan a large Konva drawing',
        fixture: `${SCALE.diagramNodes.L} shapes`,
      },
      async (s) => {
        await page.goto('/drawing');
        await s.time('openDrawing', async () => {
          await page.goto(`/drawing/editor?id=${drawing.id}`);
          await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
        });
        await waitForIdle(page);

        const canvas = page.locator('canvas').first();
        const box = await canvas.boundingBox();
        if (box) {
          await s.frameRate('pan', async () => {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            for (let i = 1; i <= 25; i += 1) {
              await page.mouse.move(
                box.x + box.width / 2 - i * 8,
                box.y + box.height / 2 - i * 4,
              );
            }
            await page.mouse.up();
          });
        }
      },
    );

    // ── E7 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'E7',
        title: 'Open presenter view on a large deck',
        fixture: `L (${SCALE.slides.L} slides)`,
      },
      async (s) => {
        await openSlides(page, deck.id);
        await waitForIdle(page);
        const heapBefore = await s.heapUsed();
        await s.resetMetrics();

        await s.time('presenterReady', async () => {
          await page.getByRole('button', { name: 'Present' }).click();
          await expect
            .poll(async () => (await page.locator('body').innerText()).includes(`1 / ${SCALE.slides.L}`), {
              timeout: 60_000,
              message: 'presenter view never showed its slide counter',
            })
            .toBe(true);
        });
        s.record('heapDelta', (await s.heapUsed()) - heapBefore, 'bytes');
        await page.keyboard.press('Escape');
      },
    );
  });

  test('E5–E6 Photos', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'photos');

    const small = await seedPhotos(session, 'M');
    const large = await seedPhotos(session, 'L');
    const bigPhoto = await seedPhotos(session, 'S', { size: 'large' });

    const cards = page.locator(`${PHOTO_GRID} > *`);

    // ── E5 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'E5',
        title: 'Photos grid with a large encrypted library',
        fixture: `M+L (${small.length + large.length + bigPhoto.length} photos)`,
        budgets: { firstRow: 8_000 },
      },
      async (s) => {
        await page.goto('/drive');
        const start = Date.now();
        await page.goto('/photos');
        await expect(cards.first()).toBeVisible({ timeout: 120_000 });
        s.record('firstRow', Date.now() - start);
        await waitForIdle(page, 750, 60_000);

        s.record('cardsInDom', await cards.count(), 'count');
        s.record('heapAfterGrid', await s.heapUsed(), 'bytes');

        await s.frameRate('scroll', () =>
          scrollThrough(page, PHOTO_GRID, { distance: 8_000, step: 60 }),
        );
      },
    );

    // ── E6 ────────────────────────────────────────────────────────────────
    await perf.scenario(
      {
        id: 'E6',
        title: 'Photo editor: open a 12 MP image and apply one filter',
        fixture: '4000 × 3000 JPEG',
        repeats: 3,
      },
      async (s) => {
        await page.goto('/photos');
        await s.time('openEditor', async () => {
          await page.goto(`/photos/editor?fileId=${bigPhoto[0].id}`);
          // Decrypt, decode and paint — a canvas alone is not evidence the
          // image arrived, so this waits for one with real dimensions.
          await expect
            .poll(
              async () =>
                page
                  .locator('canvas')
                  .first()
                  .evaluate((c) => (c as HTMLCanvasElement).width)
                  .catch(() => 0),
              { timeout: 120_000, message: 'the photo never decoded onto a canvas' },
            )
            .toBeGreaterThan(0);
        });
        await waitForIdle(page, 500, 30_000);
        s.record('heapAfterDecode', await s.heapUsed(), 'bytes');
      },
    );
  });
});
