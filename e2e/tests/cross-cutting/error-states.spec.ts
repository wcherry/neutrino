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

test.describe('Error states — Drive', () => {
  test('a fresh account has an empty drive with no file list items', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'empty_drive');
    await page.goto('/drive');

    // Verify the drive page loaded successfully
    await expect(
      page.getByRole('button', { name: 'Create new item' }),
    ).toBeVisible({ timeout: 10_000 });

    // A brand-new account has no files — there must be zero listitems in the file list
    await expect(page.locator('[role="listitem"]')).toHaveCount(0, { timeout: 10_000 });
  });

  test('navigating to a non-existent doc ID does not redirect to sign-in', async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000);

    await registerAndLogin(request, page, 'invalid_doc');

    // Navigate to a clearly invalid UUID
    await page.goto('/docs/editor?id=00000000-0000-0000-0000-000000000000');

    // Allow the page to settle (load and process the 404 from the API)
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // The app must NOT redirect the authenticated user to sign-in
    await expect(page).not.toHaveURL(/\/sign-in/);

    // The page body must have some visible content (the app shell did not crash)
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

test.describe('Error states — Share page', () => {
  test('share page with an invalid token shows a not-found message', async ({ page }) => {
    await page.goto(`${BASE_URL}/share?token=invalid-token-that-does-not-exist`);

    await expect(
      page.getByText(/share link not found|not found|invalid/i),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Error states — Notes', () => {
  test('notes page for a fresh account shows the new note CTA with no note items', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'empty_notes');
    await page.goto('/notes');

    // The empty-state call-to-action must be visible. The empty notes page
    // renders two "New Note" CTAs (header + empty-state), so scope to the first
    // to avoid a strict-mode violation (the second button mounts a beat later).
    await expect(
      page.getByRole('button', { name: /new note/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // No notes have been created — the list must be empty
    await expect(page.locator('[role="listitem"]')).toHaveCount(0, { timeout: 10_000 });
  });
});

test.describe('Error states — Upload failure', () => {
  test('a 500 error during file upload keeps the upload dialog open', async ({
    page,
    request,
  }) => {
    test.setTimeout(30_000);

    await registerAndLogin(request, page, 'upload_err');
    await page.goto('/drive');

    // Intercept the upload endpoint and return a server error
    await page.route('**/api/v1/drive/files/upload', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      }),
    );

    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Upload' }).click();

    const dialog = page.getByRole('dialog', { name: 'Upload files' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Trigger an upload attempt via the hidden file input
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'test-upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('test content'),
    });

    // After a 500 the dialog must remain open — it must not auto-close on failure
    await expect(dialog).toBeVisible({ timeout: 10_000 });
  });
});
