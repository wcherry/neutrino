import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `diagrams_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Diagrams Test User', email, password },
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

async function createDiagramViaApi(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/diagrams`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title },
  });
  expect(res.ok(), `create diagram failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

test.describe('Diagram lifecycle', () => {
  test('empty diagrams page shows "No diagrams yet"', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/diagrams');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Diagrams');
    await expect(page.getByText('No diagrams yet')).toBeVisible({ timeout: 10_000 });
  });

  test('FAB creates a diagram and navigates to the editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await expect(page.getByRole('menuitem', { name: 'Diagram' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('menuitem', { name: 'Diagram' }).click();
    await expect(page).toHaveURL(/\/diagrams\/editor\?id=/, { timeout: 15_000 });
    // The title input or title span must be visible
    await expect(page.locator('span').filter({ hasText: 'Untitled diagram' }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('"New diagram" button on the diagrams page navigates to the editor', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await page.goto('/diagrams');
    await expect(page.getByText('No diagrams yet')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'New diagram' }).first().click();
    await expect(page).toHaveURL(/\/diagrams\/editor\?id=/, { timeout: 15_000 });
  });

  test('renaming a diagram and going back shows the new title in the list', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await page.goto('/diagrams');
    await page.getByRole('button', { name: 'New diagram' }).first().click();
    await expect(page).toHaveURL(/\/diagrams\/editor\?id=/, { timeout: 15_000 });

    // Click the title to enter edit mode
    await page.locator('span').filter({ hasText: 'Untitled diagram' }).first().click();
    const titleInput = page.locator('input.titleInput, input[class*="titleInput"]').first();
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill('My Architecture Diagram');

    // Blur triggers the PATCH to save the title
    const titleSaved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/diagrams/') && r.request().method() === 'PATCH',
      { timeout: 10_000 },
    );
    await titleInput.press('Enter');
    await titleSaved;

    // Go back to the diagrams list
    await page.goto('/diagrams');
    await expect(page.getByText('My Architecture Diagram')).toBeVisible({ timeout: 10_000 });
  });

  test('diagram created via API appears in the list after page load', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    await createDiagramViaApi(request, token, 'System Overview');

    await page.goto('/diagrams');
    await expect(page.getByText('System Overview')).toBeVisible({ timeout: 10_000 });
  });

  test('clicking a diagram card in the list opens the editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const id = await createDiagramViaApi(request, token, 'Clickable Diagram');

    await page.goto('/diagrams');
    await expect(page.getByText('Clickable Diagram')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Clickable Diagram').click();
    await expect(page).toHaveURL(new RegExp(`/diagrams/editor\\?id=${id}`), { timeout: 10_000 });
  });

  test('deleting a diagram via API removes it from the list', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const id = await createDiagramViaApi(request, token, 'Diagram To Delete');

    await page.goto('/diagrams');
    await expect(page.getByText('Diagram To Delete')).toBeVisible({ timeout: 10_000 });

    const delRes = await request.delete(`${BASE_URL}/api/v1/diagrams/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.ok(), `delete failed: ${delRes.status()}`).toBeTruthy();

    await page.reload();
    await expect(page.getByText('Diagram To Delete')).not.toBeVisible({ timeout: 10_000 });
  });

  test('navigating directly to the editor without an id redirects to /diagrams', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await page.goto('/diagrams/editor');
    await expect(page).toHaveURL(/\/diagrams/, { timeout: 10_000 });
  });
});
