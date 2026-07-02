import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `slides_pres_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Presenter Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function createSlide(page: Page): Promise<void> {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Presentation' }).click();
  await expect(page).toHaveURL(/\/slides\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Slides' })).toBeVisible({ timeout: 10_000 });
}

// ── Presenter view ────────────────────────────────────────────────────────────

test.describe('Presenter view', () => {
  test('clicking Present enters presenter mode and shows the slide counter', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await createSlide(page);

    await page.getByRole('button', { name: 'Present' }).click();

    // A single-slide presentation shows "1 / 1" in the counter.
    await expect(page.locator('text=1 / 1')).toBeVisible({ timeout: 5_000 });
  });

  test('arrow-key navigation advances and retreats slides in presenter mode', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await createSlide(page);

    // Add a second slide to make navigation possible.
    await page.getByTitle('Add slide').click();
    await expect(page.locator('text=Slides (2)')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Present' }).click();
    await expect(page.locator('text=1 / 2')).toBeVisible({ timeout: 5_000 });

    // ArrowRight → slide 2
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('text=2 / 2')).toBeVisible({ timeout: 5_000 });

    // ArrowLeft → slide 1
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('text=1 / 2')).toBeVisible({ timeout: 5_000 });
  });

  test('clicking the on-screen next/prev buttons navigates slides', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await createSlide(page);

    await page.getByTitle('Add slide').click();
    await expect(page.locator('text=Slides (2)')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Present' }).click();
    await expect(page.locator('text=1 / 2')).toBeVisible({ timeout: 5_000 });

    // The next button shows "→".
    await page.getByRole('button', { name: '→' }).click();
    await expect(page.locator('text=2 / 2')).toBeVisible({ timeout: 5_000 });
  });

  test('pressing Escape in presenter mode exits back to the editor', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await createSlide(page);

    await page.getByRole('button', { name: 'Present' }).click();
    await expect(page.locator('text=1 / 1')).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');

    // Back in the editor — the title input is visible again.
    await expect(page.getByPlaceholder('Untitled presentation')).toBeVisible({ timeout: 5_000 });
  });

  test('clicking the Exit button in presenter mode returns to the editor', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await createSlide(page);

    await page.getByRole('button', { name: 'Present' }).click();
    await expect(page.locator('text=1 / 1')).toBeVisible({ timeout: 5_000 });

    // The exit button's text is "✕ Exit".
    await page.getByRole('button', { name: /Exit/ }).click();

    await expect(page.getByPlaceholder('Untitled presentation')).toBeVisible({ timeout: 5_000 });
  });
});
