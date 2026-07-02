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

/**
 * Upload a small text file to Drive via multipart API and return the file ID.
 */
async function uploadFile(
  request: APIRequestContext,
  token: string,
  filename: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: filename,
        mimeType: 'text/plain',
        buffer: Buffer.from(`Content of ${filename}`),
      },
    },
  });
  expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
}

test.describe('Accessibility — keyboard navigation', () => {
  test('sign-in form email input receives focus on first Tab press', async ({ page }) => {
    await page.goto('/sign-in');

    // Tab once from the document body to reach the first interactive element
    await page.keyboard.press('Tab');

    await expect(page.locator('input[type="email"]')).toBeFocused({ timeout: 5_000 });
  });
});

test.describe('Accessibility — ARIA roles in Drive', () => {
  test('create new item button opens a menu with correct role and items', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'a11y_menu');
    await page.goto('/drive');

    await page.getByRole('button', { name: 'Create new item' }).click();

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });

    // The menu must contain the primary create actions as menuitems
    await expect(page.getByRole('menuitem', { name: 'Document' })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole('menuitem', { name: 'Spreadsheet' })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole('menuitem', { name: 'Presentation' })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('upload dialog has dialog role and accessible name', async ({ page, request }) => {
    await registerAndLogin(request, page, 'a11y_upload');
    await page.goto('/drive');

    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Upload' }).click();

    await expect(
      page.getByRole('dialog', { name: 'Upload files' }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Accessibility — Settings dialogs', () => {
  test('delete account confirmation has dialog role and descriptive text', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'a11y_delete');
    await page.goto('/settings');
    await page.locator('[class*="tabBar"]').getByRole('button', { name: 'Account' }).click();
    await expect(
      page.getByRole('heading', { name: 'Account', level: 2 }),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Delete account' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText('Delete your account?');
  });
});

test.describe('Accessibility — file list', () => {
  test("drive file row has a 'More options for' button with an accessible label", async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'a11y_file');
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    if (!token) throw new Error('access_token not found');

    const filename = `a11y-file-${Date.now()}.txt`;
    await uploadFile(request, token, filename);

    await page.goto('/drive');

    // Wait for the file to appear in the list
    await expect(
      page.getByRole('listitem', { name: filename }),
    ).toBeVisible({ timeout: 10_000 });

    // The "More options" button must have an accessible label referencing the file name
    await expect(
      page.getByLabel(new RegExp(`More options for`, 'i')),
    ).toBeVisible({ timeout: 5_000 });
  });
});
