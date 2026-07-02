import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `drawing_lifecycle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Drawing Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

async function createDrawingViaApi(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drawing`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title },
  });
  expect(res.ok(), `create drawing failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

test.describe('Drawing lifecycle', () => {
  test('FAB creates a drawing and navigates to the editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await expect(page.getByRole('menuitem', { name: 'Drawing' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('menuitem', { name: 'Drawing' }).click();
    await expect(page).toHaveURL(/\/drawing\/editor\?id=/, { timeout: 15_000 });
  });

  test('editor loads with the default title "Untitled drawing"', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const id = await createDrawingViaApi(request, token, 'Untitled drawing');
    await page.goto(`/drawing/editor?id=${id}`);
    const titleInput = page.getByLabel('Drawing title');
    await expect(titleInput).toBeVisible({ timeout: 15_000 });
    await expect(titleInput).toHaveValue('Untitled drawing');
  });

  test('renaming the drawing triggers a PATCH and persists the new title', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const id = await createDrawingViaApi(request, token, 'Untitled drawing');
    await page.goto(`/drawing/editor?id=${id}`);

    const titleInput = page.getByLabel('Drawing title');
    await expect(titleInput).toBeVisible({ timeout: 15_000 });

    const titleSaved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/drawing/') && r.request().method() === 'PATCH',
      { timeout: 10_000 },
    );
    await titleInput.fill('My New Drawing');
    await titleInput.press('Enter');
    await titleSaved;

    // Reload to confirm the title was persisted
    await page.reload();
    await expect(page.getByLabel('Drawing title')).toHaveValue('My New Drawing', { timeout: 10_000 });
  });

  test('drawing created via API opens in the editor when navigated directly', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const id = await createDrawingViaApi(request, token, 'API Created Drawing');
    await page.goto(`/drawing/editor?id=${id}`);
    await expect(page.getByLabel('Drawing title')).toHaveValue('API Created Drawing', {
      timeout: 15_000,
    });
  });

  test('navigating to the editor without an id shows an error', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/drawing/editor');
    await expect(page.getByText('No drawing ID provided')).toBeVisible({ timeout: 10_000 });
  });

  test('the back button navigates away from the editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const id = await createDrawingViaApi(request, token, 'Back Button Drawing');
    await page.goto('/drive');
    await page.goto(`/drawing/editor?id=${id}`);
    await expect(page.getByLabel('Drawing title')).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Go back').click();
    // Should navigate away from the editor
    await expect(page).not.toHaveURL(/\/drawing\/editor/, { timeout: 10_000 });
  });

  test('deleting a drawing via API means the editor shows an error on reload', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const id = await createDrawingViaApi(request, token, 'Drawing To Delete');
    await page.goto(`/drawing/editor?id=${id}`);
    await expect(page.getByLabel('Drawing title')).toBeVisible({ timeout: 15_000 });

    const delRes = await request.delete(`${BASE_URL}/api/v1/drawing/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.ok(), `delete failed: ${delRes.status()}`).toBeTruthy();

    await page.reload();
    await expect(page.getByText('Failed to load drawing')).toBeVisible({ timeout: 10_000 });
  });
});
