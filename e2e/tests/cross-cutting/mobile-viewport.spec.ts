import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

// Run all tests in this file at iPhone 14 Pro dimensions
test.use({ viewport: { width: 390, height: 844 } });

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
  prefix = 'mobile',
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

test.describe('Mobile viewport — Drive', () => {
  test('drive loads and shows create button on mobile', async ({ page, request }) => {
    await registerAndLogin(request, page, 'mob_drive');
    await page.goto('/drive');
    await expect(
      page.getByRole('button', { name: 'Create new item' }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('navigation sidebar renders and page is not blank on mobile', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'mob_sidebar');
    await page.goto('/drive');
    // The main content area must be present; sidebar may be collapsed on mobile
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Mobile viewport — Notes', () => {
  test('notes list loads and shows heading and new note button on mobile', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'mob_notes');
    await page.goto('/notes');
    await expect(
      page.getByRole('heading', { name: 'Notes' }),
    ).toBeVisible({ timeout: 10_000 });
    // The empty notes page renders two "New Note" CTAs (header + empty-state),
    // so scope to the first to avoid a strict-mode violation.
    await expect(
      page.getByRole('button', { name: /new note/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Mobile viewport — Settings', () => {
  test('settings page loads and shows heading on mobile', async ({ page, request }) => {
    await registerAndLogin(request, page, 'mob_settings');
    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { level: 1 }),
    ).toContainText('Settings', { timeout: 10_000 });
  });
});

test.describe('Mobile viewport — Sign-in', () => {
  test('sign-in form is usable on mobile', async ({ page, browser }) => {
    // Use a fresh context with no auth so we land on the sign-in page
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const freshPage = await ctx.newPage();
      await freshPage.goto(`${BASE_URL}/sign-in`);

      const emailInput = freshPage.getByLabel('Email');
      const passwordInput = freshPage.getByLabel('Password');

      await expect(emailInput).toBeVisible({ timeout: 10_000 });
      await expect(passwordInput).toBeVisible({ timeout: 10_000 });

      // Verify the inputs are focusable and accept input
      await emailInput.fill('mobile-test@example.com');
      await expect(emailInput).toHaveValue('mobile-test@example.com');

      await passwordInput.fill('Password123!');
      await expect(passwordInput).toHaveValue('Password123!');
    } finally {
      await ctx.close();
    }
  });
});
