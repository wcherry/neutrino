/**
 * Opening a document must not save it.
 *
 * The collab room syncs the stored body into the editor as a transaction like
 * any edit, and the editor used to autosave it: every open wrote an unchanged
 * copy as a new revision with a new edit time, which then made the next page
 * load re-read and re-upload the whole search index. A real edit afterwards
 * must still save.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';

const BASE_URL = 'http://localhost:9880';

test('reopening a saved document sends no save until it is edited', async ({ page, request }) => {
  const email = `doc_open_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Doc Open Test', email, password: 'Password123!' },
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
  await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });
  const url = page.url();
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await page.keyboard.type('# Heading');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Body with ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('bold');
  // The typing's own autosave, done before the reload — otherwise the pagehide
  // flush of a pending save would land after the listener below.
  await page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/autosave') && r.ok(),
    { timeout: 15_000 },
  );
  await page.waitForTimeout(3_000);

  const saves: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/autosave')) saves.push(r.url());
  });

  await page.goto(url);
  await expect(editor).toContainText('Body with bold', { timeout: 15_000 });
  // Longer than the autosave delay, so a save the load scheduled would have gone out.
  await page.waitForTimeout(6_000);
  expect(saves, 'opening the document saved it').toEqual([]);

  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' and an edit');
  await expect.poll(() => saves.length, { timeout: 15_000 }).toBeGreaterThan(0);

  await page.goto(url);
  await expect(editor).toContainText('and an edit', { timeout: 15_000 });
});
