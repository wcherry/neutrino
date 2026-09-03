import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Regression cover for issue #130 — "Multi-day Events Only Show First Day".
 *
 * A multi-day event was drawn as a chip on the day it started and nowhere else,
 * so the days it booked afterwards looked free. The month grid now draws one bar
 * covering every day of the run, split at the week boundary.
 */

const BASE_URL = 'http://localhost:9880';

// A `date`-typed event boundary is wall-clock, so the browser and the seeded
// events have to agree on a zone for the days to line up.
test.use({ timezoneId: 'UTC' });

function uniqueEmail(): string {
  return `cal_span_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Cal Span User', email, password },
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

/** The month the calendar opens on, read off the browser's own clock. */
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
): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/v1/calendar/events`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { allDay: false, ...event },
  });
  expect(res.ok(), `create event failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/** The first day of a run that stays inside one week row of the month grid. */
async function midWeekRun(page: Page): Promise<{ year: number; month: number; first: number }> {
  const { year, month } = await browserMonth(page);
  // Walk to a day whose weekday leaves at least two days before Saturday, so a
  // three-day run does not wrap onto the next row.
  for (let day = 8; day <= 20; day++) {
    const weekday = new Date(year, month, day).getDay(); // 0 = Sunday
    if (weekday >= 1 && weekday <= 4) return { year, month, first: day };
  }
  throw new Error('no mid-week day in the 8th–20th — impossible');
}

test.describe('Calendar multi-day events (issue #130)', () => {
  test('an all-day event over three days is one bar covering all three', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('three days');

    await page.goto('/calendar');
    await expect(page.getByTestId('month-grid')).toBeVisible({ timeout: 15_000 });
    const { year, month, first } = await midWeekRun(page);

    await createEventViaApi(request, token, {
      title,
      startTime: `${ymd(year, month, first)}T00:00:00Z`,
      endTime: `${ymd(year, month, first + 2)}T23:59:59Z`,
      allDay: true,
    });
    await page.reload();

    const bar = page.getByRole('button', { name: title });
    await expect(bar).toHaveCount(1, { timeout: 15_000 });
    await expect(bar).toHaveAttribute('data-event-span', '3');
    await expect(bar).toHaveAttribute('data-event-start-date', ymd(year, month, first));

    // Geometry, not just the attribute: the bar really does reach across the
    // last day's cell. It used to sit inside the first day's cell alone.
    const barBox = (await bar.boundingBox())!;
    const firstCell = (await page.locator(`[data-date="${ymd(year, month, first)}"]`).boundingBox())!;
    const lastCell = (await page.locator(`[data-date="${ymd(year, month, first + 2)}"]`).boundingBox())!;
    expect(barBox.x).toBeGreaterThanOrEqual(firstCell.x - 1);
    expect(barBox.x + barBox.width).toBeGreaterThan(lastCell.x + lastCell.width / 2);
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(lastCell.x + lastCell.width + 1);
  });

  test('a timed event running overnight covers both days', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('overnight');

    await page.goto('/calendar');
    await expect(page.getByTestId('month-grid')).toBeVisible({ timeout: 15_000 });
    const { year, month, first } = await midWeekRun(page);

    await createEventViaApi(request, token, {
      title,
      startTime: `${ymd(year, month, first)}T22:00:00Z`,
      endTime: `${ymd(year, month, first + 1)}T03:00:00Z`,
    });
    await page.reload();

    const bar = page.getByRole('button', { name: title });
    await expect(bar).toHaveCount(1, { timeout: 15_000 });
    await expect(bar).toHaveAttribute('data-event-span', '2');
  });

  test('an event crossing a week boundary is drawn on both week rows', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('across weeks');

    await page.goto('/calendar');
    await expect(page.getByTestId('month-grid')).toBeVisible({ timeout: 15_000 });
    const { year, month } = await browserMonth(page);

    // Start on a Friday in the second week so the run passes over a Saturday.
    let friday = 0;
    for (let day = 8; day <= 21 && friday === 0; day++) {
      if (new Date(year, month, day).getDay() === 5) friday = day;
    }
    expect(friday, 'no Friday between the 8th and the 21st').toBeGreaterThan(0);

    await createEventViaApi(request, token, {
      title,
      startTime: `${ymd(year, month, friday)}T00:00:00Z`,
      endTime: `${ymd(year, month, friday + 3)}T23:59:59Z`,
      allDay: true,
    });
    await page.reload();

    // Two bars — Friday/Saturday on one row, Sunday/Monday on the next.
    const bars = page.getByRole('button', { name: title });
    await expect(bars).toHaveCount(2, { timeout: 15_000 });
    await expect(bars.nth(0)).toHaveAttribute('data-event-start-date', ymd(year, month, friday));
    await expect(bars.nth(1)).toHaveAttribute('data-event-start-date', ymd(year, month, friday + 2));
  });

  test('agenda view lists a multi-day event under every day it covers', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const title = uniqueTitle('agenda span');

    await page.goto('/calendar');
    await expect(page.getByTestId('month-grid')).toBeVisible({ timeout: 15_000 });
    const { year, month, first } = await midWeekRun(page);

    await createEventViaApi(request, token, {
      title,
      startTime: `${ymd(year, month, first)}T00:00:00Z`,
      endTime: `${ymd(year, month, first + 2)}T23:59:59Z`,
      allDay: true,
    });
    await page.reload();

    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await expect(page.getByText(title)).toHaveCount(3, { timeout: 15_000 });
  });
});
