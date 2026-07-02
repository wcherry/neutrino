import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `cal_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Cal Test User', email, password },
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

/** Create an all-day event for today via the REST API and return its ID. */
async function createEventViaApi(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const res = await request.post(`${BASE_URL}/api/v1/calendar/events`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      title,
      startTime: `${today}T00:00:00Z`,
      endTime: `${today}T23:59:59Z`,
      allDay: true,
    },
  });
  expect(res.ok(), `create event failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

test.describe('Calendar event lifecycle', () => {
  // ── Create via UI ──────────────────────────────────────────────────────────

  test('creates an event via the New Event modal and shows it in month view', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const title = uniqueTitle('UI create');

    await page.goto('/calendar');
    await page.getByRole('button', { name: 'New Event' }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByRole('heading', { name: 'New Event' })).toBeVisible();

    await dialog.getByPlaceholder('Event title').fill(title);
    await dialog.getByRole('button', { name: 'Create Event' }).click();

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    // Month view renders a <button> chip for each event
    await expect(page.getByRole('button', { name: title })).toBeVisible({ timeout: 10_000 });
  });

  // ── API-seeded events in both views ────────────────────────────────────────

  test('event created via API appears in month view', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('API month');
    await createEventViaApi(request, token, title);

    await page.goto('/calendar');
    await expect(page.getByRole('button', { name: title })).toBeVisible({ timeout: 10_000 });
  });

  test('event created via API appears in agenda view', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('API agenda');
    await createEventViaApi(request, token, title);

    await page.goto('/calendar');
    await page.getByRole('button', { name: 'Agenda' }).click();
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
  });

  // ── View detail modal ──────────────────────────────────────────────────────

  test('clicking an event in month view opens its detail modal', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('click modal');
    await createEventViaApi(request, token, title);

    await page.goto('/calendar');
    await page.getByRole('button', { name: title }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
  });

  // ── Edit ───────────────────────────────────────────────────────────────────

  test('editing an event updates its title in month view', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const originalTitle = uniqueTitle('before edit');
    const updatedTitle = uniqueTitle('after edit');
    await createEventViaApi(request, token, originalTitle);

    await page.goto('/calendar');
    await page.getByRole('button', { name: originalTitle }).click();

    // Detail modal opens with the original title as heading
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByRole('heading', { name: originalTitle })).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Edit' }).click();

    // Edit modal replaces the detail modal
    await expect(dialog.getByRole('heading', { name: 'Edit Event' })).toBeVisible({ timeout: 5_000 });
    const titleInput = dialog.getByPlaceholder('Event title');
    await titleInput.clear();
    await titleInput.fill(updatedTitle);
    await dialog.getByRole('button', { name: 'Save Changes' }).click();

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: updatedTitle })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: originalTitle })).not.toBeVisible();
  });

  // ── Delete ─────────────────────────────────────────────────────────────────

  test('deleting an event removes it from month view', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('delete me');
    await createEventViaApi(request, token, title);

    await page.goto('/calendar');
    await page.getByRole('button', { name: title }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByRole('heading', { name: title })).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: title })).not.toBeVisible({ timeout: 10_000 });
  });

  // ── Agenda view click ──────────────────────────────────────────────────────

  test('clicking an event in agenda view opens its detail modal', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('agenda click');
    await createEventViaApi(request, token, title);

    await page.goto('/calendar');
    await page.getByRole('button', { name: 'Agenda' }).click();

    // Agenda events are divs — target by text content
    await page.getByText(title).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
  });
});
