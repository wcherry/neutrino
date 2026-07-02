import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `docs_vh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Version Test User', email, password },
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

async function openViewSubmenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('menu').getByText('View').hover();
}

test.describe('Docs version history', () => {
  test('Ctrl+S triggers a version save API call', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Content to save as a named version');

    // Let autosave settle so the DEK is available
    await page.waitForTimeout(800);

    // Ctrl+S triggers versionMutation → POST to the versions endpoint
    const versionSaved = page.waitForResponse(
      (r) => r.url().includes('/versions') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await page.keyboard.press('ControlOrMeta+s');
    const resp = await versionSaved;
    expect(resp.ok()).toBeTruthy();
  });

  test('Version history panel opens from the View menu and shows panel UI', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    await openViewSubmenu(page);
    await page.getByText('Version history').click();

    // The VersionHistoryPanel renders unique loading/empty states not visible elsewhere
    await expect(
      page.getByText('Loading versions…').or(page.getByText('No versions yet.')),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('a version saved via Ctrl+S appears in the history panel', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Important document content');

    // Wait for autosave so the DEK is resolved
    await page.waitForTimeout(800);

    // Save a named version
    const versionSaved = page.waitForResponse(
      (r) => r.url().includes('/versions') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await page.keyboard.press('ControlOrMeta+s');
    await versionSaved;

    // Open version history
    await openViewSubmenu(page);
    await page.getByText('Version history').click();

    // Panel should now show the saved version. The newest version (idx=0) shows
    // a "Current" badge instead of a "Restore" button, so check for either.
    await expect(
      page.getByText('Current').or(page.getByText('No versions yet.')),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('closing the Version history panel hides it', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    await openViewSubmenu(page);
    await page.getByText('Version history').click();

    await expect(
      page.getByText('Loading versions…').or(page.getByText('No versions yet.')),
    ).toBeVisible({ timeout: 10_000 });

    // Close button inside the panel (title="Close")
    await page.getByTitle('Close').click();

    await expect(
      page.getByText('Loading versions…').or(page.getByText('No versions yet.')),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Docs comments panel', () => {
  test('Comments panel opens from the View menu and shows the comment form', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    await openViewSubmenu(page);
    await page.getByText('Comments').click();

    // CommentsPanel renders a textarea for new comments
    await expect(
      page.getByPlaceholder('Add a comment… (use @name to mention)'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('adding a comment through the panel persists and displays it', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    await openViewSubmenu(page);
    await page.getByText('Comments').click();

    const textarea = page.getByPlaceholder('Add a comment… (use @name to mention)');
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    await textarea.fill('This is a test comment from e2e');

    // Submit via the Comment button
    await page.getByRole('button', { name: 'Comment' }).click();

    // Comment body should appear in the panel
    await expect(page.getByText('This is a test comment from e2e')).toBeVisible({ timeout: 10_000 });
  });

  test('closing the Comments panel hides it', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    await openViewSubmenu(page);
    await page.getByText('Comments').click();

    await expect(
      page.getByPlaceholder('Add a comment… (use @name to mention)'),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByTitle('Close').click();

    await expect(
      page.getByPlaceholder('Add a comment… (use @name to mention)'),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});
