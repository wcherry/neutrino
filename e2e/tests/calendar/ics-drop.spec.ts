import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

/**
 * An `.ics` dropped onto Calendar, or added to Drive, puts its events in the calendar.
 */

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `ics_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'ICS Test User', email, password },
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

/** A two-event calendar, both in the coming week so they show in the default views. */
function icsFor(titles: [string, string]): string {
  const day = (offset: number) => {
    const d = new Date(Date.now() + offset * 86_400_000);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  };
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${titles[0]}@example.com`,
    `SUMMARY:${titles[0]}`,
    `DTSTART:${day(1)}T150000Z`,
    `DTEND:${day(1)}T160000Z`,
    'END:VEVENT',
    'BEGIN:VEVENT',
    `UID:${titles[1]}@example.com`,
    `SUMMARY:${titles[1]}`,
    `DTSTART;VALUE=DATE:${day(2)}`,
    `DTEND;VALUE=DATE:${day(3)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

async function dropIcs(page: Page, target: Locator, content: string): Promise<void> {
  const dataTransfer = await page.evaluateHandle((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'invite.ics', { type: 'text/calendar' }));
    return dt;
  }, content);
  await target.dispatchEvent('drop', { dataTransfer });
}

async function eventTitles(page: Page, request: APIRequestContext): Promise<string[]> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  const from = new Date(Date.now() - 86_400_000).toISOString();
  const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const res = await request.get(`${BASE_URL}/api/v1/calendar/events?from=${from}&to=${to}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  const data = await res.json() as { events: { title: string }[] };
  return data.events.map((e) => e.title);
}

test.describe('Adding an .ics to the calendar', () => {
  test('dropping one onto Calendar adds every event in it, once', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const titles: [string, string] = [uniqueTitle('Dropped meeting'), uniqueTitle('Dropped trip')];

    await page.goto('/calendar');
    const area = page.getByTestId('calendar-drop-area');
    await dropIcs(page, area, icsFor(titles));

    await expect(page.getByText('Added 2 events to your calendar')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(titles[0]).first()).toBeVisible({ timeout: 10_000 });
    expect(await eventTitles(page, request)).toEqual(expect.arrayContaining(titles));

    // The same file again adds nothing.
    await dropIcs(page, area, icsFor(titles));
    await expect(page.getByText('Those events are already in your calendar')).toBeVisible({ timeout: 10_000 });
    const after = await eventTitles(page, request);
    expect(after.filter((t) => t === titles[0])).toHaveLength(1);
  });

  test('uploading one to Drive stores it and adds its events', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const titles: [string, string] = [uniqueTitle('Drive meeting'), uniqueTitle('Drive trip')];

    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Upload' }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload files' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dropIcs(page, dialog.getByRole('button', { name: 'Drag & drop files here' }), icsFor(titles));

    await expect(page.getByText('Added 2 events to your calendar')).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '100', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Done' }).click();

    const filesSection = page.locator('[aria-labelledby="all-files-heading"]');
    await expect(filesSection.getByRole('listitem', { name: 'invite.ics' })).toBeVisible({ timeout: 10_000 });
    expect(await eventTitles(page, request)).toEqual(expect.arrayContaining(titles));
  });
});
