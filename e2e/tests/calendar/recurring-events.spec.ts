import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

/**
 * Editing and deleting a repeating event or reminder as "this", "this and following" or "all"
 * (agent_docs/recurrence-exceptions.md), through the web calendar against the real server.
 *
 * Each test seeds a daily 10:00 UTC event over seven days in the middle of the current month
 * (the 10th to the 16th, which every month has), so the whole series is on the month grid the
 * calendar opens on.
 */

const BASE_URL = 'http://localhost:9880';

// The series is seeded in UTC; the browser must expand it in UTC for the days to line up.
test.use({ timezoneId: 'UTC' });

const FIRST_DAY = 10;
const DAYS = 7;

function uniqueEmail(): string {
  return `cal_repeat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<string> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Cal Repeat User', email, password },
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

/** `YYYY-MM-DD` for a day of the current month, in UTC like the browser. */
function day(n: number): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${`${now.getUTCMonth() + 1}`.padStart(2, '0')}-${`${n}`.padStart(2, '0')}`;
}

const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

/** A daily 10:00–10:30 UTC event on the 10th to the 16th. Returns its id. */
async function seedSeries(request: APIRequestContext, token: string, title: string): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/calendar/events`, {
    headers: headers(token),
    data: {
      title,
      startTime: `${day(FIRST_DAY)}T10:00:00Z`,
      endTime: `${day(FIRST_DAY)}T10:30:00Z`,
      allDay: false,
      recurrenceRule: `FREQ=DAILY;COUNT=${DAYS}`,
      timezone: 'UTC',
    },
  });
  expect(res.ok(), `create event failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

interface ListedEvent {
  id: string;
  title: string;
  recurrenceRule: string | null;
  recurringEventId?: string | null;
  cancelled?: boolean;
}

async function listEvents(request: APIRequestContext, token: string): Promise<ListedEvent[]> {
  const from = `${day(1)}T00:00:00Z`;
  const to = `${day(28)}T23:59:59Z`;
  const res = await request.get(`${BASE_URL}/api/v1/calendar/events?from=${from}&to=${to}&exceptions=true`, {
    headers: headers(token),
  });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { events: ListedEvent[] }).events;
}

/** The month-grid bar of the occurrence on day `n` titled `title`. */
function bar(page: Page, title: string, n: number): Locator {
  return page.locator(`[data-testid="event-bar"][data-event-start-date="${day(n)}"]`, { hasText: title });
}

/** Every month-grid bar titled exactly `title`. */
function bars(page: Page, title: string): Locator {
  return page.locator('[data-testid="event-bar"]').filter({ hasText: title });
}

async function openCalendar(page: Page, title: string): Promise<void> {
  await page.goto('/calendar');
  await expect(page.getByTestId('month-grid')).toBeVisible({ timeout: 15_000 });
  await expect(bars(page, title)).toHaveCount(DAYS, { timeout: 15_000 });
}

/** Opens the occurrence on day `n`, presses `action` in its detail modal, and picks `scope`. */
async function choose(page: Page, title: string, n: number, action: 'Edit' | 'Delete', scope: string): Promise<void> {
  await bar(page, title, n).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('heading', { name: title })).toBeVisible({ timeout: 5_000 });
  await detail.getByRole('button', { name: action, exact: true }).click();

  const prompt = page.getByRole('dialog');
  await expect(prompt.getByRole('heading', { name: `${action} repeating event` })).toBeVisible({ timeout: 5_000 });
  await prompt.getByRole('button', { name: scope, exact: true }).click();
}

async function renameInForm(page: Page, to: string): Promise<void> {
  const form = page.getByRole('dialog');
  await expect(form.getByRole('heading', { name: 'Edit Event' })).toBeVisible({ timeout: 5_000 });
  const titleInput = form.getByPlaceholder('Event title');
  await titleInput.clear();
  await titleInput.fill(to);
  await form.getByRole('button', { name: 'Save Changes' }).click();
  await expect(form).not.toBeVisible({ timeout: 10_000 });
}

test.describe('Calendar repeating events', () => {
  test('editing this event changes that occurrence only', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const title = uniqueTitle('Standup');
    const renamed = uniqueTitle('Planning');
    const seriesId = await seedSeries(request, token, title);
    await openCalendar(page, title);

    await choose(page, title, 12, 'Edit', 'This event');
    // One occurrence can't repeat, so the form doesn't offer it.
    await expect(page.getByRole('dialog').getByLabel('Repeats')).toHaveCount(0);
    await renameInForm(page, renamed);

    await expect(bar(page, renamed, 12)).toHaveCount(1, { timeout: 10_000 });
    await expect(bars(page, renamed)).toHaveCount(1);
    await expect(bars(page, title)).toHaveCount(DAYS - 1);

    const exceptions = (await listEvents(request, token)).filter((e) => e.recurringEventId === seriesId);
    expect(exceptions.map((e) => e.title)).toEqual([renamed]);
  });

  test('deleting this event removes that occurrence only', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const title = uniqueTitle('Standup');
    await seedSeries(request, token, title);
    await openCalendar(page, title);

    await choose(page, title, 13, 'Delete', 'This event');

    await expect(bars(page, title)).toHaveCount(DAYS - 1, { timeout: 10_000 });
    await expect(bar(page, title, 13)).toHaveCount(0);
    await expect(bar(page, title, 14)).toHaveCount(1);

    // It stays deleted after a reload: the server holds it, not the page.
    await page.reload();
    await expect(bars(page, title)).toHaveCount(DAYS - 1, { timeout: 15_000 });
    await expect(bar(page, title, 13)).toHaveCount(0);
  });

  test('editing this and following splits the series at that occurrence', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const title = uniqueTitle('Standup');
    const renamed = uniqueTitle('Sync');
    const seriesId = await seedSeries(request, token, title);
    await openCalendar(page, title);

    await choose(page, title, 14, 'Edit', 'This and following events');
    // The 14th is the fifth of seven, so the new series has three left.
    await expect(page.getByRole('dialog').getByLabel('Number of occurrences')).toHaveValue('3');
    await renameInForm(page, renamed);

    await expect(bars(page, renamed)).toHaveCount(3, { timeout: 10_000 });
    await expect(bars(page, title)).toHaveCount(4);
    for (const n of [14, 15, 16]) await expect(bar(page, renamed, n)).toHaveCount(1);
    for (const n of [10, 11, 12, 13]) await expect(bar(page, title, n)).toHaveCount(1);

    const events = await listEvents(request, token);
    const old = events.find((e) => e.id === seriesId)!;
    expect(old.recurrenceRule).toBe(`FREQ=DAILY;UNTIL=${day(13).replace(/-/g, '')}T235959Z`);
    const split = events.find((e) => e.title === renamed)!;
    expect(split.recurrenceRule).toBe('FREQ=DAILY;COUNT=3');
  });

  test('deleting this and following ends the series before that occurrence', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const title = uniqueTitle('Standup');
    await seedSeries(request, token, title);
    await openCalendar(page, title);

    await choose(page, title, 14, 'Delete', 'This and following events');

    await expect(bars(page, title)).toHaveCount(4, { timeout: 10_000 });
    for (const n of [14, 15, 16]) await expect(bar(page, title, n)).toHaveCount(0);
  });

  test('editing all events renames the series from its own start, keeping an occurrence changed on its own', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const title = uniqueTitle('Standup');
    const own = uniqueTitle('Own title');
    const renamed = uniqueTitle('Daily sync');
    const seriesId = await seedSeries(request, token, title);
    const res = await request.put(
      `${BASE_URL}/api/v1/calendar/events/${seriesId}/occurrences/${day(11)}T10:00:00Z`,
      { headers: headers(token), data: { title: own } },
    );
    expect(res.ok(), `edit occurrence failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    await page.goto('/calendar');
    await expect(bars(page, title)).toHaveCount(DAYS - 1, { timeout: 15_000 });

    await choose(page, title, 15, 'Edit', 'All events');
    // The series from its own start, not from the occurrence that was clicked.
    const start = page.getByRole('dialog').locator('input[type="datetime-local"]').first();
    await expect(start).toHaveValue(new RegExp(`^${day(FIRST_DAY)}T10:00`));
    await renameInForm(page, renamed);

    await expect(bars(page, renamed)).toHaveCount(DAYS - 1, { timeout: 10_000 });
    await expect(bar(page, own, 11)).toHaveCount(1);
    await expect(bar(page, renamed, FIRST_DAY)).toHaveCount(1);
  });

  test('deleting all events removes the series', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const title = uniqueTitle('Standup');
    await seedSeries(request, token, title);
    await openCalendar(page, title);

    await choose(page, title, 12, 'Delete', 'All events');

    await expect(bars(page, title)).toHaveCount(0, { timeout: 10_000 });
    expect(await listEvents(request, token)).toEqual([]);
  });

  test('editing this reminder makes a one-off and moves the repeating one on', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const title = uniqueTitle('Vitamins');
    const renamed = uniqueTitle('Vitamins with food');
    const due = new Date(Date.now() + 2 * 86_400_000);
    due.setUTCHours(9, 0, 0, 0);
    const created = await request.post(`${BASE_URL}/api/v1/calendar/reminders`, {
      headers: headers(token),
      data: { title, dueTime: due.toISOString(), recurrenceRule: 'FREQ=DAILY' },
    });
    expect(created.ok()).toBeTruthy();
    const reminderId = ((await created.json()) as { id: string }).id;

    await page.goto('/calendar');
    const row = page.getByText(title, { exact: true }).locator('xpath=ancestor::div[.//button[@title="Edit"]][1]');
    await row.getByTitle('Edit').click();

    const prompt = page.getByRole('dialog');
    await expect(prompt.getByRole('heading', { name: 'Edit repeating reminder' })).toBeVisible({ timeout: 5_000 });
    await prompt.getByRole('button', { name: 'This reminder', exact: true }).click();

    const form = page.getByRole('dialog');
    await expect(form.getByLabel('Repeats')).toHaveCount(0);
    const titleInput = form.getByPlaceholder('Reminder title');
    await titleInput.clear();
    await titleInput.fill(renamed);
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).not.toBeVisible({ timeout: 10_000 });

    await expect(page.getByText(renamed, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    const series = await request.get(`${BASE_URL}/api/v1/calendar/reminders/${reminderId}`, { headers: headers(token) });
    const moved = (await series.json()) as { dueTime: string; completed: boolean };
    expect(Date.parse(moved.dueTime)).toBe(due.getTime() + 86_400_000);
    expect(moved.completed).toBe(false);
  });
});
