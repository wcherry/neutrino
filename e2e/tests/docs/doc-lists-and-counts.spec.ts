/**
 * Two things that only a real browser shows.
 *
 * List markers: the UI reset sets `list-style: none` on every list, and the list extension only
 * writes an inline style for a non-default type, so a plain bullet or numbered list drew no marker.
 *
 * The status bar's counts: a document opened from Drive is loaded without Tiptap's `update` event,
 * which is all the counts listened for, so they read "0 words" until the first keystroke.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = `docs_lists_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Docs Lists User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
}

async function openNewDoc(page: Page): Promise<void> {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Document' }).click();
  await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
}

const markerOf = (page: Page, list: 'ul' | 'ol') =>
  page.locator(`.ProseMirror ${list}`).first().evaluate((el) => getComputedStyle(el).listStyleType);

test.describe('Docs lists and counts', () => {
  test('bullet and numbered lists draw their markers', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    // Markdown input rules: "- " starts a bullet list, "1. " a numbered one.
    await editor.pressSequentially('- First item');
    await page.keyboard.press('Enter');
    await editor.pressSequentially('Second item');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await editor.pressSequentially('1. One');

    await expect(editor.locator('ul > li')).toHaveCount(2);
    await expect(editor.locator('ol > li')).toHaveCount(1);
    expect(await markerOf(page, 'ul')).toBe('disc');
    expect(await markerOf(page, 'ol')).toBe('decimal');
  });

  test('a reopened document shows its word count straight away', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    // The autosave that carries the typed text, so the reload reads it back from storage.
    const saved = page.waitForResponse(
      (r) => /\/api\/v1\/drive\/files\/[^/]+\/autosave/.test(r.url()) && r.ok(),
      { timeout: 20_000 },
    );
    await editor.pressSequentially('The quick brown fox jumps');
    await expect(page.getByText('5 words')).toBeVisible();
    await saved;

    // Opened again from storage: loaded without an `update` event, and nothing typed since.
    await page.reload();
    await expect(editor).toContainText('The quick brown fox jumps', { timeout: 15_000 });
    await expect(page.getByText('5 words')).toBeVisible();
    await expect(page.getByText('0 words')).toHaveCount(0);
  });
});
