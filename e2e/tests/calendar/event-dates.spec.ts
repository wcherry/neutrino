import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

/**
 * Regression cover for the event modal's date fields.
 *
 * Issue #129 — moving the start date left the end date where it was, so an
 * event edited forwards ended before it began.
 */

const BASE_URL = 'http://localhost:9880';

// The values below are wall-clock, and a `datetime-local` input shows the
// browser's local time, so the browser and the assertions have to agree on a
// zone. UTC is the one the seeded events are written in.
test.use({ timezoneId: 'UTC' });

function uniqueEmail(): string {
  return `cal_dates_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Cal Dates User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
}

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

/**
 * The month the calendar opens on, read off the browser's own clock rather than
 * the runner's — near a month boundary the two can disagree.
 */
async function browserMonth(page: Page): Promise<{ year: number; month: number }> {
  return page.evaluate(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
}

/** `YYYY-MM-DD` for a day of the given (0-based) month. */
function ymd(year: number, month: number, day: number): string {
  return `${year}-${`${month + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

async function createEventViaApi(
  request: APIRequestContext,
  token: string,
  event: { title: string; startTime: string; endTime: string; allDay?: boolean },
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/calendar/events`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { allDay: false, ...event },
  });
  expect(res.ok(), `create event failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

/** Open an event's Edit modal from its month-view chip. */
async function openEditModal(page: Page, title: string): Promise<Locator> {
  await page.getByRole('button', { name: title }).first().click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog.getByRole('heading', { name: title })).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Edit' }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit Event' })).toBeVisible({ timeout: 10_000 });
  return dialog;
}

/** Start and End inputs, in DOM order — the labels are not associated with them. */
function dateFields(dialog: Locator): { start: Locator; end: Locator } {
  const inputs = dialog.locator('input[type="datetime-local"], input[type="date"]');
  return { start: inputs.nth(0), end: inputs.nth(1) };
}

test.describe('Calendar event dates (issue #129)', () => {
  test('moving the start date in the edit modal moves the end date with it', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('shift dates');

    await page.goto('/calendar');
    await expect(page.getByTestId('month-grid')).toBeVisible({ timeout: 15_000 });
    const { year, month } = await browserMonth(page);

    // The example from the issue: the 12th to the 14th, moved to start on the 15th.
    await createEventViaApi(request, token, {
      title,
      startTime: `${ymd(year, month, 12)}T09:00:00Z`,
      endTime: `${ymd(year, month, 14)}T09:00:00Z`,
    });
    await page.reload();

    const dialog = await openEditModal(page, title);
    const { start, end } = dateFields(dialog);
    await expect(start).toHaveValue(`${ymd(year, month, 12)}T09:00`);
    await expect(end).toHaveValue(`${ymd(year, month, 14)}T09:00`);

    await start.fill(`${ymd(year, month, 15)}T09:00`);

    // The gap is preserved, so the end lands on the 17th rather than staying
    // on the 14th — which is where it used to sit, before the new start.
    await expect(end).toHaveValue(`${ymd(year, month, 17)}T09:00`);
  });

  test('the shifted end date is what gets saved', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('shift saved');

    await page.goto('/calendar');
    await expect(page.getByTestId('month-grid')).toBeVisible({ timeout: 15_000 });
    const { year, month } = await browserMonth(page);

    await createEventViaApi(request, token, {
      title,
      startTime: `${ymd(year, month, 12)}T09:00:00Z`,
      endTime: `${ymd(year, month, 14)}T09:00:00Z`,
    });
    await page.reload();

    const dialog = await openEditModal(page, title);
    await dateFields(dialog).start.fill(`${ymd(year, month, 15)}T09:00`);
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await expect(dialog.getByRole('heading', { name: 'Edit Event' })).not.toBeVisible({ timeout: 10_000 });

    // Read it back from the server: the event still lasts two days.
    const res = await request.get(`${BASE_URL}/api/v1/calendar/events?from=${ymd(year, month, 1)}T00:00:00Z&to=${ymd(year, month, 28)}T00:00:00Z`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok(), `list events failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const body = await res.json() as { events: { title: string; startTime: string; endTime: string }[] };
    const saved = body.events.find((e) => e.title === title);
    expect(saved, `event "${title}" missing from the listing`).toBeTruthy();
    expect(new Date(saved!.endTime).getTime()).toBeGreaterThan(new Date(saved!.startTime).getTime());
    expect(saved!.startTime).toContain(ymd(year, month, 15));
    expect(saved!.endTime).toContain(ymd(year, month, 17));
  });

  test('editing only the end date leaves the start where it was', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('end only');

    await page.goto('/calendar');
    await expect(page.getByTestId('month-grid')).toBeVisible({ timeout: 15_000 });
    const { year, month } = await browserMonth(page);

    await createEventViaApi(request, token, {
      title,
      startTime: `${ymd(year, month, 12)}T09:00:00Z`,
      endTime: `${ymd(year, month, 12)}T10:00:00Z`,
    });
    await page.reload();

    const dialog = await openEditModal(page, title);
    const { start, end } = dateFields(dialog);
    await end.fill(`${ymd(year, month, 13)}T10:00`);

    await expect(start).toHaveValue(`${ymd(year, month, 12)}T09:00`);
    await expect(end).toHaveValue(`${ymd(year, month, 13)}T10:00`);
  });
});
