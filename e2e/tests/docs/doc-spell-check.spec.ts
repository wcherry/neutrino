import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `docs_spell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Spell Check Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function openNewDoc(page: Page): Promise<void> {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Document' }).click();
  await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
}

test.describe('Docs spell check', () => {
  test('misspelled words get spell-error decoration', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('This sentense haz a mistak');

    // nspell loads asynchronously — wait up to 20s for the first decoration to appear
    await expect(editor.locator('.spell-error').first()).toBeVisible({ timeout: 20_000 });
  });

  test('correctly spelled text has no spell-error decoration', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();

    // Prime nspell by typing a misspelled word first and waiting for it to be flagged,
    // confirming the dictionary is loaded before we check the absence of errors.
    await editor.pressSequentially('mistak');
    await expect(editor.locator('.spell-error')).toHaveCount(1, { timeout: 20_000 });

    // Clear and type entirely correct text
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Backspace');
    await editor.pressSequentially('The quick brown fox jumps over the lazy dog');

    await expect(editor.locator('.spell-error')).toHaveCount(0, { timeout: 5_000 });
  });

  test('right-clicking a misspelled word shows spell suggestions in the context menu', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('helllo');

    const misspelled = editor.locator('.spell-error').first();
    await expect(misspelled).toBeVisible({ timeout: 20_000 });

    // Left-click first to ensure empty selection, then right-click to open context menu
    await misspelled.click();
    await misspelled.click({ button: 'right' });

    const menu = page.getByRole('menu', { name: 'Editor options' });
    await expect(menu).toBeVisible({ timeout: 5_000 });

    // Spell suggestions are rendered as the first menuitems, before the standard items
    await expect(menu.getByRole('menuitem').first()).toBeVisible({ timeout: 5_000 });
  });

  test('clicking a spell suggestion replaces the misspelled word', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('helllo');

    const misspelled = editor.locator('.spell-error').first();
    await expect(misspelled).toBeVisible({ timeout: 20_000 });

    await misspelled.click();
    await misspelled.click({ button: 'right' });

    const menu = page.getByRole('menu', { name: 'Editor options' });
    await expect(menu).toBeVisible({ timeout: 5_000 });

    // Capture the suggestion text before clicking so we can verify it was applied
    const firstSuggestion = menu.getByRole('menuitem').first();
    await expect(firstSuggestion).toBeVisible({ timeout: 5_000 });
    const corrected = (await firstSuggestion.textContent())?.trim() ?? '';
    await firstSuggestion.click();

    // The misspelled word should now be gone
    await expect(editor.locator('.spell-error')).toHaveCount(0, { timeout: 5_000 });
    // The suggestion text should appear in the document
    if (corrected) {
      await expect(editor).toContainText(corrected, { timeout: 5_000 });
    }
  });

  test('words inside code blocks are not flagged as spelling errors', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();

    // Prime nspell by confirming it flags normal misspelled text
    await editor.pressSequentially('speling ');
    await expect(editor.locator('.spell-error')).toHaveCount(1, { timeout: 20_000 });

    // Create a code block via the ``` markdown shortcut and type a misspelled word inside
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('```');
    await page.keyboard.press('Enter');
    await editor.pressSequentially('misspeled codeword');

    // Code-block content must not receive spell-error decorations
    const codeBlock = editor.locator('pre code');
    await expect(codeBlock).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(2_000);
    await expect(codeBlock.locator('.spell-error')).toHaveCount(0);
  });

  test('toggling spell check off removes spell-error decorations', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('speling errror');

    await expect(editor.locator('.spell-error').first()).toBeVisible({ timeout: 20_000 });

    // Toggle spell check off via the keyboard shortcut (Cmd+Shift+; on macOS)
    await editor.click();
    await page.keyboard.press('Meta+Shift+;');

    await expect(editor.locator('.spell-error')).toHaveCount(0, { timeout: 5_000 });
  });

  test('re-enabling spell check restores spell-error decorations', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('speling errror');

    await expect(editor.locator('.spell-error').first()).toBeVisible({ timeout: 20_000 });

    // Toggle off
    await editor.click();
    await page.keyboard.press('Meta+Shift+;');
    await expect(editor.locator('.spell-error')).toHaveCount(0, { timeout: 5_000 });

    // Toggle back on — decorations should reappear
    await page.keyboard.press('Meta+Shift+;');
    await expect(editor.locator('.spell-error').first()).toBeVisible({ timeout: 10_000 });
  });
});
