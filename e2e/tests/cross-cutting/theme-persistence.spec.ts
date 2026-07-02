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
 * Navigate to /settings, open the Appearance tab, select the given theme,
 * save, and wait for the save confirmation.
 */
async function setTheme(page: Page, themeName: 'Dark' | 'Light'): Promise<void> {
  await page.goto('/settings');
  await page.locator('[class*="tabBar"]').getByRole('button', { name: 'Appearance' }).click();
  await expect(
    page.getByRole('heading', { name: 'Appearance', level: 2 }),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: themeName, exact: true }).click();
  await page.getByRole('button', { name: 'Save appearance' }).click();
  await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });
}

test.describe('Theme persistence', () => {
  test('dark theme is applied to /drive after being set in settings', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'theme_drive');
    await setTheme(page, 'Dark');

    await page.goto('/drive');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 5_000 });
  });

  test('dark theme persists on /settings after a page reload', async ({ page, request }) => {
    await registerAndLogin(request, page, 'theme_reload');
    await setTheme(page, 'Dark');

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 5_000 });
  });

  test('dark theme persists when navigating to /notes', async ({ page, request }) => {
    await registerAndLogin(request, page, 'theme_notes');
    await setTheme(page, 'Dark');

    await page.goto('/notes');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 5_000 });
  });

  test('switching back to Light removes the dark theme attribute', async ({ page, request }) => {
    await registerAndLogin(request, page, 'theme_light');

    // First set dark
    await setTheme(page, 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 5_000 });

    // Then switch to light
    await setTheme(page, 'Light');

    await page.goto('/drive');

    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark', {
      timeout: 5_000,
    });
  });
});
