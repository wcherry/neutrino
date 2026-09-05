/**
 * The page-driving vocabulary the scenarios share.
 *
 * Deliberately thin. A perf scenario should read as "open this, do that,
 * assert the median" — the selectors and the waiting belong here so that a
 * change to the Drive markup is one edit rather than forty, and so that a
 * scenario body contains nothing but the thing being measured.
 *
 * Everything here waits on something the *user* would see. A scenario that
 * waits on a network response instead reports the server's time and not the
 * app's, which is the misattribution §11 warns about.
 */

import { expect, type Locator, type Page } from '@playwright/test';

/** How long a fixture-scale render is allowed to take before it is a failure. */
export const RENDER_TIMEOUT = 120_000;

// ── Drive ───────────────────────────────────────────────────────────────────

/** The Files section of `/drive` — the grid, not Quick access above it. */
export function filesSection(page: Page): Locator {
  return page.locator('[aria-labelledby="all-files-heading"]');
}

export function driveRows(page: Page): Locator {
  return filesSection(page).getByRole('listitem');
}

/** Wait until at least one row has painted. */
export async function waitForFirstRow(page: Page): Promise<void> {
  await expect(driveRows(page).first()).toBeVisible({ timeout: RENDER_TIMEOUT });
}

/**
 * Scroll until Drive has loaded and rendered every file it has.
 *
 * `/drive` fetches 200 at a time and appends on an IntersectionObserver at the
 * bottom of the list (`CONTENTS_PAGE_SIZE` in `drive/page.tsx`), so a bare
 * `goto` renders 200 rows however many the account holds. That matters for the
 * unvirtualized-grid hypothesis in §8: the cost does not arrive on load, it
 * arrives as you scroll, and each page appends to a list that is never
 * windowed. This is what actually grows the DOM to `expected` rows.
 */
export async function loadAllDriveRows(page: Page, expected: number): Promise<number> {
  const rows = driveRows(page);
  await waitForFirstRow(page);

  let previous = -1;
  for (let guard = 0; guard < 200; guard += 1) {
    const count = await rows.count();
    if (count >= expected) return count;
    if (count === previous) {
      // Two passes with no growth and the list is as long as it gets — an
      // account with fewer files than asked for, or a page that stopped
      // fetching. Either way there is nothing left to wait on.
      return count;
    }
    previous = count;
    await rows.last().scrollIntoViewIfNeeded();
    await page
      .waitForFunction(
        (n) =>
          document.querySelectorAll(
            '[aria-labelledby="all-files-heading"] [role="listitem"]',
          ).length > n,
        count,
        { timeout: 20_000 },
      )
      .catch(() => {
        // Falls through to the no-growth check above on the next pass.
      });
  }
  return rows.count();
}

/** Open a file's three-dot menu, the way the functional specs do. */
export async function openRowMenu(page: Page, fileName: string): Promise<void> {
  await page.getByRole('listitem', { name: fileName }).first().hover();
  await page.getByLabel(`More options for ${fileName}`).click();
  await expect(page.getByRole('menu', { name: 'File options' })).toBeVisible({
    timeout: 15_000,
  });
}

export type ViewMode = 'Large grid' | 'Small grid' | 'Detailed list';

export async function switchView(page: Page, mode: ViewMode): Promise<void> {
  await page.getByRole('group', { name: 'View mode' }).getByLabel(mode).click();
}

export async function toggleFilterChip(page: Page, label: string): Promise<void> {
  await page.getByRole('group', { name: 'Filter files' }).getByText(label, { exact: true }).click();
}

// ── Editors ─────────────────────────────────────────────────────────────────

/**
 * Open an editor by file id and wait for it to be usable.
 *
 * The wait is on the editing surface rather than on the route, because every
 * one of these editors renders its chrome before the content is decrypted and
 * parsed — a scenario that stopped at the URL would report the time to paint
 * a toolbar.
 */
export async function openDoc(page: Page, fileId: string): Promise<void> {
  await page.goto(`/docs/editor?id=${fileId}`);
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: RENDER_TIMEOUT });
  await expect(page.locator('.ProseMirror p, .ProseMirror h1, .ProseMirror h2').first())
    .toBeVisible({ timeout: RENDER_TIMEOUT });
}

export async function openSheet(page: Page, fileId: string): Promise<void> {
  await page.goto(`/sheets/editor?id=${fileId}`);
  await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
}

export async function openSlides(page: Page, fileId: string): Promise<void> {
  await page.goto(`/slides/editor?id=${fileId}`);
  await expect(page.getByRole('button', { name: 'Slides' })).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
}

/**
 * How many slides the rail says the open deck has, or `null` before it knows.
 *
 * Read out of the page's text rather than with a `text=Slides (6)` locator.
 * The rail's label is split across elements and CSS-uppercased, so no single
 * element's text is the string being looked for — the locator matches nothing
 * and waits out its timeout while the number is plainly on screen.
 */
export async function slideCount(page: Page): Promise<number | null> {
  const text = await page.locator('body').innerText().catch(() => '');
  const match = /slides\s*\((\d+)\)/i.exec(text);
  return match ? Number(match[1]) : null;
}

/** Wait for the deck's thumbnail rail to report `expected` slides. */
export async function waitForSlideCount(page: Page, expected: number): Promise<void> {
  await expect
    .poll(() => slideCount(page), {
      timeout: RENDER_TIMEOUT,
      message: `the slide rail never reported ${expected} slides`,
    })
    .toBe(expected);
}

export async function openDiagram(page: Page, fileId: string): Promise<void> {
  await page.goto(`/diagrams/editor?id=${fileId}`);
  // `DiagramCanvas` draws in **SVG**, not on a `<canvas>` — Konva is the
  // Drawing app. Waiting for a `<canvas>` here waits out the full timeout on a
  // diagram that rendered correctly.
  await expect(page.getByTitle('Select (V)')).toBeVisible({ timeout: RENDER_TIMEOUT });
  await expect(page.locator('svg').first()).toBeVisible({ timeout: RENDER_TIMEOUT });
}

/** Set one cell through the formula bar — the same path `sheet-formulas.spec` uses. */
export async function setCell(page: Page, ref: string, value: string): Promise<void> {
  await page.locator(`[data-type="cell"][id="${ref}"]`).click();
  const input = page.getByTestId('formula-bar-input');
  await input.fill(value);
  await input.press('Enter');
}

// ── Scrolling ───────────────────────────────────────────────────────────────

/**
 * The element that actually scrolls under `selector`.
 *
 * The app shell scrolls a pane, not the document, and which pane differs per
 * app. Rather than hard-coding one selector per scenario, this walks up from a
 * known element and returns the first ancestor that can scroll — including
 * `document.scrollingElement`, when the page really is the scroller.
 */
async function scrollerFor(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const start = document.querySelector(sel);
    let node: Element | null = start;
    while (node) {
      const style = getComputedStyle(node);
      const scrollable = /auto|scroll|overlay/.test(style.overflowY);
      if (scrollable && node.scrollHeight > node.clientHeight + 8) {
        // Tag it so the scroll loop can find the same element again without
        // re-walking, and without needing a stable class name.
        node.setAttribute('data-perf-scroller', '1');
        return '[data-perf-scroller="1"]';
      }
      node = node.parentElement;
    }
    document.scrollingElement?.setAttribute('data-perf-scroller', '1');
    return '[data-perf-scroller="1"]';
  }, selector);
}

/**
 * Scroll `distance` pixels in fixed steps, one per animation frame.
 *
 * A `mouse.wheel` loop would be more faithful to a user, and is also what makes
 * this measurement unusable: the wheel events are delivered asynchronously and
 * coalesced, so the scroll distance per run varies and so does everything
 * derived from it. Driving `scrollTop` frame by frame gives every repeat the
 * same distance in the same number of frames, which is what a dropped-frame
 * ratio needs to mean anything.
 */
export async function scrollThrough(
  page: Page,
  anchorSelector: string,
  opts: { distance: number; step?: number },
): Promise<void> {
  const scroller = await scrollerFor(page, anchorSelector);
  await page.evaluate(
    async ({ sel, distance, step }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const frame = (): Promise<void> =>
        new Promise((resolve) => requestAnimationFrame(() => resolve()));
      let moved = 0;
      while (moved < distance) {
        el.scrollTop += step;
        moved += step;
        await frame();
      }
    },
    { sel: scroller, distance: opts.distance, step: opts.step ?? 40 },
  );
}

/** Horizontal counterpart, for the Sheets grid. */
export async function scrollAcross(
  page: Page,
  anchorSelector: string,
  opts: { distance: number; step?: number },
): Promise<void> {
  const scroller = await scrollerFor(page, anchorSelector);
  await page.evaluate(
    async ({ sel, distance, step }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const frame = (): Promise<void> =>
        new Promise((resolve) => requestAnimationFrame(() => resolve()));
      let moved = 0;
      while (moved < distance) {
        el.scrollLeft += step;
        moved += step;
        await frame();
      }
    },
    { sel: scroller, distance: opts.distance, step: opts.step ?? 40 },
  );
}

// ── Idle ────────────────────────────────────────────────────────────────────

/**
 * Wait until the main thread has been quiet for `quietMs`.
 *
 * The "time to interactive" proxy in §5. Not the standardised TTI — that is
 * defined against a five-second window and needs a trace — but the same idea
 * and enough to tell "the page settled" from "the page is still working".
 */
export async function waitForIdle(page: Page, quietMs = 500, timeout = 30_000): Promise<void> {
  await page.evaluate(
    async ({ quiet, limit }) => {
      const start = performance.now();
      let lastLongTask = performance.now();
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          lastLongTask = Math.max(lastLongTask, entry.startTime + entry.duration);
        }
      });
      try {
        observer.observe({ type: 'longtask', buffered: true });
      } catch {
        return;
      }
      const frame = (): Promise<void> =>
        new Promise((resolve) => requestAnimationFrame(() => resolve()));
      while (performance.now() - start < limit) {
        if (performance.now() - lastLongTask > quiet) break;
        await frame();
      }
      observer.disconnect();
    },
    { quiet: quietMs, limit: timeout },
  );
}

/** Type `text` one character at a time, so each keystroke is its own interaction. */
export async function typeSlowly(
  target: Locator,
  text: string,
  delayMs = 30,
): Promise<void> {
  await target.pressSequentially(text, { delay: delayMs });
}
