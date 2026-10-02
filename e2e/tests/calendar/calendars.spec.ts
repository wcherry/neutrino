import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

/**
 * Calendars (#236) and holiday calendars (#237), through the web calendar against the real
 * server: colour, show/hide that survives a reload, the event form's calendar, read-only
 * enforced by the API, and a country's holidays computed in the browser. See
 * agent_docs/calendars.md.
 */

const BASE_URL = 'http://localhost:9880';

// Events are seeded in UTC, and holiday names are asked for in the browser's language.
test.use({ timezoneId: 'UTC', locale: 'en-US' });

function uniqueEmail(): string {
  return `cal_calendars_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<string> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Cal Calendars User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

/** `YYYY-MM-DD` for a day of the current month, in UTC like the browser. */
function day(n: number): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${`${now.getUTCMonth() + 1}`.padStart(2, '0')}-${`${n}`.padStart(2, '0')}`;
}

interface Calendar {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  readOnly: boolean;
  kind: string;
  isDefault: boolean;
}

async function listCalendars(request: APIRequestContext, token: string): Promise<Calendar[]> {
  const res = await request.get(`${BASE_URL}/api/v1/calendar/calendars`, { headers: headers(token) });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { calendars: Calendar[] }).calendars;
}

async function seedEvent(
  request: APIRequestContext,
  token: string,
  title: string,
  calendarId?: string,
): Promise<{ id: string; calendarId: string }> {
  const res = await request.post(`${BASE_URL}/api/v1/calendar/events`, {
    headers: headers(token),
    data: {
      title,
      startTime: `${day(12)}T10:00:00Z`,
      endTime: `${day(12)}T11:00:00Z`,
      timezone: 'UTC',
      ...(calendarId ? { calendarId } : {}),
    },
  });
  expect(res.ok(), `create event failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; calendarId: string };
}

function bars(page: Page, title: string): Locator {
  return page.locator('[data-testid="event-bar"]').filter({ hasText: title });
}

async function openCalendar(page: Page): Promise<void> {
  await page.goto('/calendar');
  await expect(page.getByTestId('month-grid')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('calendars-sidebar')).toBeVisible({ timeout: 15_000 });
}

/** The fourth Thursday of November in `year`, `YYYY-MM-DD`. */
function thanksgiving(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - first + 7) % 7);
  return `${year}-11-${firstThursday + 21}`;
}

/** Moves the calendar, which opens on the current month, to November of this year or next. */
async function goToNovember(page: Page): Promise<number> {
  const now = new Date();
  const year = now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const months = (year - now.getUTCFullYear()) * 12 + 10 - now.getUTCMonth();
  for (let i = 0; i < Math.abs(months); i++) {
    await page.getByRole('button', { name: months > 0 ? 'Next period' : 'Previous period' }).click();
  }
  await expect(page.getByTestId('period-label')).toContainText(`November ${year}`);
  return year;
}

test.describe('Calendars', () => {
  test('every user starts with a default calendar that existing and new events land in', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const [only] = await listCalendars(request, token);
    expect(only).toMatchObject({ isDefault: true, kind: 'local', readOnly: false, visible: true });

    const event = await seedEvent(request, token, uniqueName('Lunch'));
    expect(event.calendarId).toBe(only.id);
  });

  test('a new calendar colours its events, and hiding it hides them across a reload', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const name = uniqueName('Work');
    const title = uniqueName('Review');
    await openCalendar(page);

    // Made from the sidebar, in a chosen colour.
    await page.getByRole('button', { name: 'New calendar' }).click();
    await page.getByLabel('Calendar name').fill(name);
    await page.getByRole('radio', { name: '#e11d48' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByLabel(`Show ${name}`)).toBeChecked({ timeout: 10_000 });

    const work = (await listCalendars(request, token)).find((c) => c.name === name)!;
    expect(work.color).toBe('#e11d48');
    await seedEvent(request, token, title, work.id);

    await page.reload();
    await expect(bars(page, title)).toHaveCount(1, { timeout: 15_000 });
    await expect(bars(page, title)).toHaveAttribute('style', /--event-solid:\s*#e11d48/);

    await page.getByLabel(`Show ${name}`).uncheck();
    await expect(bars(page, title)).toHaveCount(0);
    // Hidden on the server, so it stays hidden after a reload, and nothing was deleted.
    await page.reload();
    await expect(page.getByLabel(`Show ${name}`)).not.toBeChecked({ timeout: 15_000 });
    await expect(bars(page, title)).toHaveCount(0);

    await page.getByLabel(`Show ${name}`).check();
    await expect(bars(page, title)).toHaveCount(1, { timeout: 10_000 });
  });

  test('the event form puts a new event in the calendar picked', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const name = uniqueName('Family');
    const title = uniqueName('Picnic');
    const created = await request.post(`${BASE_URL}/api/v1/calendar/calendars`, {
      headers: headers(token),
      data: { name, color: '#16a34a' },
    });
    expect(created.status()).toBe(201);
    const family = (await created.json()) as Calendar;
    await openCalendar(page);

    await page.getByRole('button', { name: 'New Event' }).click();
    const form = page.getByRole('dialog');
    await form.getByPlaceholder('Event title').fill(title);
    await form.getByLabel('Calendar').selectOption({ label: name });
    await form.getByRole('button', { name: /create/i }).click();
    await expect(form).not.toBeVisible({ timeout: 10_000 });

    const res = await request.get(`${BASE_URL}/api/v1/calendar/events?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z`, {
      headers: headers(token),
    });
    const events = ((await res.json()) as { events: { title: string; calendarId: string }[] }).events;
    expect(events.find((e) => e.title === title)?.calendarId).toBe(family.id);
  });

  test('the API refuses events in a read-only calendar', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const holidays = await request.post(`${BASE_URL}/api/v1/calendar/calendars`, {
      headers: headers(token),
      data: { kind: 'holidays', country: 'US', name: 'United States' },
    });
    expect(holidays.status()).toBe(201);
    const us = (await holidays.json()) as Calendar;
    expect(us.readOnly).toBe(true);

    const into = await request.post(`${BASE_URL}/api/v1/calendar/events`, {
      headers: headers(token),
      data: { title: 'Party', startTime: `${day(12)}T10:00:00Z`, endTime: `${day(12)}T11:00:00Z`, calendarId: us.id },
    });
    expect(into.status()).toBe(403);

    const mine = await seedEvent(request, token, uniqueName('Mine'));
    const moved = await request.put(`${BASE_URL}/api/v1/calendar/events/${mine.id}`, {
      headers: headers(token),
      data: { calendarId: us.id },
    });
    expect(moved.status()).toBe(403);
  });
});

test.describe('Holiday calendars', () => {
  test('United States holidays appear in month and agenda views, read-only, and can be hidden', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);

    await page.goto('/settings?tab=calendar');
    const section = page.getByTestId('holidays-section');
    await expect(section).toBeVisible({ timeout: 15_000 });
    await section.getByLabel('Search countries').fill('United States');
    await section.getByRole('button', { name: /United States of America/ }).click();
    await expect(section.getByTestId('holiday-row')).toHaveCount(1, { timeout: 10_000 });
    await expect(section.getByTestId('holiday-row')).toHaveAttribute('data-country', 'US');

    const us = (await listCalendars(request, token)).find((c) => c.kind === 'holidays')!;
    expect(us).toMatchObject({ readOnly: true, visible: true });

    await openCalendar(page);
    const year = await goToNovember(page);
    const bar = page.locator(`[data-testid="event-bar"][data-event-start-date="${thanksgiving(year)}"]`, {
      hasText: 'Thanksgiving Day',
    });
    await expect(bar).toHaveCount(1, { timeout: 15_000 });

    // Read-only: the detail has no edit or delete.
    await bar.click();
    const detail = page.getByRole('dialog');
    await expect(detail.getByRole('heading', { name: 'Thanksgiving Day' })).toBeVisible();
    await expect(detail.getByTestId('event-calendar')).toContainText('Read-only');
    await expect(detail.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await detail.getByRole('button', { name: 'Close', exact: true }).last().click();

    await page.getByRole('button', { name: 'Agenda' }).click();
    await expect(page.getByTestId('agenda-event').filter({ hasText: 'Thanksgiving Day' })).toHaveCount(1);

    // Hidden, not deleted: the calendar stays, its holidays go.
    await page.getByRole('button', { name: 'Month' }).click();
    await page.getByLabel(`Show ${us.name}`).uncheck();
    await expect(bar).toHaveCount(0);
    expect((await listCalendars(request, token)).find((c) => c.id === us.id)?.visible).toBe(false);
  });

  test('Labor Day is the first Monday of September', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const created = await request.post(`${BASE_URL}/api/v1/calendar/calendars`, {
      headers: headers(token),
      data: { kind: 'holidays', country: 'US', name: 'United States' },
    });
    expect(created.status()).toBe(201);

    await openCalendar(page);
    const now = new Date();
    // September of this year, or next once it has passed.
    const year = now.getUTCMonth() > 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    const months = (year - now.getUTCFullYear()) * 12 + 8 - now.getUTCMonth();
    for (let i = 0; i < Math.abs(months); i++) {
      await page.getByRole('button', { name: months > 0 ? 'Next period' : 'Previous period' }).click();
    }
    await expect(page.getByTestId('period-label')).toContainText(`September ${year}`);
    const firstDay = new Date(Date.UTC(year, 8, 1)).getUTCDay();
    const laborDay = `${year}-09-${`${1 + ((8 - firstDay) % 7)}`.padStart(2, '0')}`;
    await expect(
      page.locator(`[data-testid="event-bar"][data-event-start-date="${laborDay}"]`, { hasText: 'Labor Day' }),
    ).toHaveCount(1, { timeout: 15_000 });
  });
});
