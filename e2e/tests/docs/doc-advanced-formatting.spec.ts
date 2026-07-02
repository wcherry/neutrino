import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `docs_fmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Format Test User', email, password },
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

test.describe('Docs advanced formatting', () => {
  // ── Tables ─────────────────────────────────────────────────────────────────

  test('inserting a table places a 3×3 grid in the editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    await page.getByTitle('Insert table').click();
    await expect(page.locator('.ProseMirror table')).toBeVisible({ timeout: 5_000 });
    // 3 rows × 3 columns = 9 cells (1 header row with th, 2 body rows with td)
    await expect(page.locator('.ProseMirror td, .ProseMirror th')).toHaveCount(9, { timeout: 3_000 });
  });

  test('adding a row increases the table row count', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    await page.getByTitle('Insert table').click();
    await expect(page.locator('.ProseMirror table')).toBeVisible({ timeout: 5_000 });

    await page.getByTitle('Add row').click();
    // 4 rows × 3 columns = 12 cells
    await expect(page.locator('.ProseMirror td, .ProseMirror th')).toHaveCount(12, { timeout: 3_000 });
  });

  test('adding a column increases the table column count', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    await page.getByTitle('Insert table').click();
    await expect(page.locator('.ProseMirror table')).toBeVisible({ timeout: 5_000 });

    await page.getByTitle('Add column').click();
    // 3 rows × 4 columns = 12 cells
    await expect(page.locator('.ProseMirror td, .ProseMirror th')).toHaveCount(12, { timeout: 3_000 });
  });

  test('deleting a table removes it from the editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    await page.getByTitle('Insert table').click();
    await expect(page.locator('.ProseMirror table')).toBeVisible({ timeout: 5_000 });

    await page.getByTitle('Delete table').click();
    await expect(page.locator('.ProseMirror table')).toHaveCount(0, { timeout: 3_000 });
  });

  // ── Lists ──────────────────────────────────────────────────────────────────

  test('creating a bullet list renders a <ul> with list items', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    await page.locator('.ProseMirror').click();
    await page.getByTitle('Bulleted list').click();
    await page.locator('.ProseMirror').pressSequentially('First item');
    await page.keyboard.press('Enter');
    await page.locator('.ProseMirror').pressSequentially('Second item');

    await expect(page.locator('.ProseMirror ul')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.ProseMirror ul li')).toHaveCount(2, { timeout: 3_000 });
  });

  test('creating a numbered list renders an <ol> with list items', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    await page.locator('.ProseMirror').click();
    await page.getByTitle('Numbered list').click();
    await page.locator('.ProseMirror').pressSequentially('Step one');
    await page.keyboard.press('Enter');
    await page.locator('.ProseMirror').pressSequentially('Step two');

    await expect(page.locator('.ProseMirror ol')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.ProseMirror ol li')).toHaveCount(2, { timeout: 3_000 });
  });

  // ── Text alignment ─────────────────────────────────────────────────────────

  test('center alignment applies text-align:center to the paragraph', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Centered text');
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByTitle('Align center').click();

    await expect(
      editor.locator('p[style*="text-align: center"], p[style*="text-align:center"]'),
    ).toBeVisible({ timeout: 3_000 });
  });

  test('right alignment applies text-align:right to the paragraph', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Right-aligned text');
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByTitle('Align right').click();

    await expect(
      editor.locator('p[style*="text-align: right"], p[style*="text-align:right"]'),
    ).toBeVisible({ timeout: 3_000 });
  });

  // ── Blockquote ─────────────────────────────────────────────────────────────

  test('clicking the Quote button wraps content in a <blockquote>', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('A quoted passage');
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByTitle('Quote').click();

    await expect(editor.locator('blockquote')).toBeVisible({ timeout: 3_000 });
  });

  // ── Strikethrough ─────────────────────────────────────────────────────────

  test('strikethrough wraps selected text in <s>', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Strike through this');
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByTitle('Strikethrough').click();

    await expect(editor.locator('s')).toBeVisible({ timeout: 3_000 });
  });

  // ── Inline code ────────────────────────────────────────────────────────────

  test('inline code button wraps selected text in <code>', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('const x = 42;');
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByTitle('Inline code').click();

    await expect(editor.locator('code')).toBeVisible({ timeout: 3_000 });
  });

  // ── Undo / Redo ────────────────────────────────────────────────────────────

  test('undo removes the last formatting change and redo restores it', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Hello world');
    await page.keyboard.press('ControlOrMeta+a');
    await page.getByTitle('Bold (Ctrl+B)').click();
    await expect(editor.locator('strong')).toBeVisible({ timeout: 3_000 });

    // Undo the bold
    await page.getByTitle('Undo (Ctrl+Z)').click();
    await expect(editor.locator('strong')).toHaveCount(0, { timeout: 3_000 });

    // Redo restores the bold
    await page.getByTitle('Redo (Ctrl+Y)').click();
    await expect(editor.locator('strong')).toBeVisible({ timeout: 3_000 });
  });

  // ── Highlight ──────────────────────────────────────────────────────────────

  test('highlight button wraps selected text in a <mark>', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Highlight this sentence');
    await page.keyboard.press('ControlOrMeta+a');

    // Highlight color picker — click the highlight swatch button
    const highlightBtn = page.getByTitle('Highlight color');
    await highlightBtn.click();
    // Pick the first swatch from the color picker portal
    const swatch = page.locator('[data-color-picker-portal] button[title^="#"]').first();
    await expect(swatch).toBeVisible({ timeout: 5_000 });
    await swatch.click();

    await expect(editor.locator('mark')).toBeVisible({ timeout: 3_000 });
  });
});
