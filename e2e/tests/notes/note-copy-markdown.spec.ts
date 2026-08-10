import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `notes_copymd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Notes Copy Markdown Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function createNoteViaApi(request: APIRequestContext, page: Page, title: string): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  const res = await request.post(`${BASE_URL}/api/v1/notes`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title },
  });
  expect(res.ok(), `create note failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Type a paragraph into block 1, then two bullet items after it (typing
 * "- " triggers the editor's own markdown auto-convert, exactly like a real
 * user), leaving the caret in the last block.
 */
async function typeThreeBlocks(page: Page): Promise<void> {
  await page.getByText('Start writing…', { exact: false }).locator('xpath=..').click();
  const block1 = page.getByRole('textbox', { name: 'Block 1' });
  await expect(block1).toBeVisible({ timeout: 5_000 });
  await block1.fill('Alpha with **bold** text');
  await block1.press('End');
  await block1.press('Enter');

  const block2 = page.getByRole('textbox', { name: 'Block 2' });
  await expect(block2).toBeVisible({ timeout: 5_000 });
  await block2.pressSequentially('- First bullet');
  await block2.press('End');
  await block2.press('Enter');

  const block3 = page.getByRole('textbox', { name: 'Block 3' });
  await expect(block3).toBeVisible({ timeout: 5_000 });
  await block3.pressSequentially('- Second bullet');
  await block3.press('End');
}

test.describe('Notes — copying a multi-block selection writes Markdown', () => {
  test('Select all then Ctrl+C puts Markdown (with **bold** and "- " bullets) on the clipboard', async ({
    page,
    context,
    request,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await registerAndLogin(request, page);
    const noteId = await createNoteViaApi(request, page, 'Copy Markdown Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await typeThreeBlocks(page);

    // Confirm the bullets actually auto-converted (sanity check before the
    // real assertion — a raw "- " literal in the markdown would otherwise
    // look identical to a real bullet).
    await expect(page.locator('[class*="blockPrefix"]').first()).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('Alpha with **bold** text');
    expect(clipboard).toContain('- First bullet');
    expect(clipboard).toContain('- Second bullet');
  });

  test('copying a selection within a single block does not rewrite it as Markdown', async ({
    page,
    context,
    request,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await registerAndLogin(request, page);
    const noteId = await createNoteViaApi(request, page, 'Single Block Copy Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await page.getByText('Start writing…', { exact: false }).locator('xpath=..').click();
    const block1 = page.getByRole('textbox', { name: 'Block 1' });
    await expect(block1).toBeVisible({ timeout: 5_000 });
    await block1.fill('Just one plain paragraph');
    await block1.press('End');

    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);

    // Native copy of a single block's own textarea selection — its exact
    // (unconverted) plain text, since there's no block-level Markdown
    // structure to add within one paragraph.
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe('Just one plain paragraph');
  });
});
