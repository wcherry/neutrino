import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
  prefix = 'test',
): Promise<{ email: string; password: string }> {
  const email = uniqueEmail(prefix);
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  return { email, password };
}

test.describe('Autosave persistence — docs', () => {
  test('typed content in a doc is persisted after page reload', async ({ page, request }) => {
    test.setTimeout(60_000);

    await registerAndLogin(request, page, 'autosave_doc');

    // Create new doc via drive FAB
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Document' }).click();
    await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });

    // Type content into the editor
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Autosave persistence check doc');

    // Wait for autosave to be acknowledged by the server
    await page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/drive/files/') &&
        ['POST', 'PUT'].includes(r.request().method()),
      { timeout: 20_000 },
    );

    // Reload the page (hard reload discards React state)
    await page.reload();
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 15_000 });

    // The typed text must survive the round-trip
    await expect(page.locator('.ProseMirror')).toContainText(
      'Autosave persistence check doc',
      { timeout: 10_000 },
    );
  });
});

test.describe('Autosave persistence — slides', () => {
  test('presentation title is persisted after page reload', async ({ page, request }) => {
    test.setTimeout(60_000);

    await registerAndLogin(request, page, 'autosave_slides');

    // Create new presentation via drive FAB
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Presentation' }).click();
    await expect(page).toHaveURL(/\/slides\/editor\/?\?id=/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Slides' })).toBeVisible({ timeout: 10_000 });

    // Fill in the title
    await page.getByPlaceholder('Untitled presentation').fill('Autosave Slide Title');

    // Wait for the PATCH to the slides API (title save)
    await page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/slides/') && r.request().method() === 'PATCH',
      { timeout: 10_000 },
    );

    // Wait for the autosave to drive files
    await page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/drive/files/') &&
        ['POST', 'PUT'].includes(r.request().method()),
      { timeout: 20_000 },
    );

    await page.reload();

    // Title must survive reload
    await expect(page.getByPlaceholder('Untitled presentation')).toHaveValue(
      'Autosave Slide Title',
      { timeout: 15_000 },
    );
  });
});

test.describe('Autosave persistence — notes', () => {
  test('note title and body text are persisted after page reload', async ({ page, request }) => {
    test.setTimeout(60_000);

    await registerAndLogin(request, page, 'autosave_notes');

    await page.goto('/notes');
    await page.getByRole('button', { name: /new note/i }).click();
    await expect(page).toHaveURL(/\/notes\//, { timeout: 15_000 });

    // Fill in the title
    await page.getByLabel('Note title').fill('Autosave Note Title');

    // Click the body placeholder area to focus it
    await page
      .getByText('Start writing…', { exact: false })
      .locator('xpath=..')
      .click();

    // Type into Block 1
    await page.getByRole('textbox', { name: 'Block 1' }).fill('Autosave note body text');

    // Blur back to title to trigger save
    await page.getByLabel('Note title').click();

    // Wait for the API save
    await page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/notes/') &&
        ['PUT', 'PATCH', 'POST'].includes(r.request().method()),
      { timeout: 15_000 },
    );

    await page.reload();

    await expect(page.getByLabel('Note title')).toHaveValue('Autosave Note Title', { timeout: 15_000 });
    await expect(page.getByText('Autosave note body text')).toBeVisible({ timeout: 10_000 });
  });
});
