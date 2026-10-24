/**
 * A long document scrolls inside the editor.
 *
 * The editor area sits in the panel rail's view, which is not a flex container, and once grew to
 * the document's full height: its scroller then had nothing to scroll and a trackpad or wheel
 * scrolled the window, which moved nothing.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';

const BASE_URL = 'http://localhost:9880';

test('the wheel scrolls a long document inside the editor, not the window', async ({ page, request }) => {
  const email = `doc_scroll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Doc Scroll Test', email, password: 'Password123!' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok()).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Password123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);

  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Document' }).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.type('Top line');
  for (let i = 0; i < 80; i++) await page.keyboard.press('Enter');
  await page.keyboard.type('Bottom line');
  await page.keyboard.press('ControlOrMeta+Home');

  // The rail's view holds the editor area at its own height rather than clipping a taller one.
  const sizes = await page.locator('[data-rail-view]').evaluate((view) => ({
    view: view.clientHeight,
    content: (view.firstElementChild as HTMLElement).offsetHeight,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.view);

  const scroller = page.locator('[class*="editorScroll"]');
  const before = await scroller.evaluate((el) => el.scrollTop);
  // Over the middle of the scroller's visible part: the document's own top can be above the window.
  const box = (await scroller.boundingBox())!;
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, page.viewportSize()!.height);
  await page.mouse.move(box.x + box.width / 2, (top + bottom) / 2);
  await page.mouse.wheel(0, 800);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
