import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Regression cover for issue #160 — "Calendar Missing 31st for August 2026".
 *
 * The month grid used to be `overflow: hidden` with shrinkable week rows, so a
 * month needing six week rows lost its last week off the bottom: the days were
 * in the DOM but clipped away and unreachable, and how many weeks survived
 * depended on the window height. The grid now scrolls instead.
 */

const BASE_URL = 'http://localhost:9880';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** A window short enough that six full-height weeks cannot fit — as in the issue's screenshot. */
const SHORT_VIEWPORT = { width: 1280, height: 560 };
const TALL_VIEWPORT = { width: 1280, height: 1000 };

function uniqueEmail(): string {
  return `cal_scroll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Cal Scroll User', email, password },
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

/** How many week rows the month grid needs, for a Sunday week start (the default). */
function weekRowsInMonth(year: number, month: number): number {
  const leadingBlanks = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.ceil((leadingBlanks + daysInMonth) / 7);
}

/**
 * Open the calendar on a month that needs six week rows — August 2026 is one, but
 * the test must not depend on when it runs, so it walks forward from whichever
 * month the page opened on. The starting month is read off the toolbar rather
 * than from the runner's own clock, so the two never disagree.
 */
async function goToSixWeekMonth(page: Page): Promise<{ year: number; month: number }> {
  await page.goto('/calendar');
  await expect(page.getByTestId('month-grid')).toBeVisible({ timeout: 15_000 });

  const label = await page.getByTestId('period-label').innerText();
  const [monthName, yearText] = label.trim().split(' ');
  const startMonth = MONTHS.indexOf(monthName);
  expect(startMonth, `unexpected period label: ${label}`).toBeGreaterThanOrEqual(0);

  for (let clicks = 0; clicks < 24; clicks++) {
    const d = new Date(Number(yearText), startMonth + clicks, 1);
    if (weekRowsInMonth(d.getFullYear(), d.getMonth()) !== 6) continue;

    for (let i = 0; i < clicks; i++) {
      await page.getByRole('button', { name: 'Next period' }).click();
    }
    await expect(page.getByTestId('period-label'))
      .toHaveText(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
    return { year: d.getFullYear(), month: d.getMonth() };
  }
  throw new Error('no six-week month within two years — impossible, check weekRowsInMonth');
}

/** `YYYY-MM-DD` for the last day of the given month. */
function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(year, month + 1, 0).getDate();
  return `${year}-${`${month + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

test.describe('Calendar month view scrolling (issue #160)', () => {
  test('a six-week month renders all six weeks', async ({ page, request }) => {
    await page.setViewportSize(SHORT_VIEWPORT);
    await registerAndLogin(request, page);
    const { year, month } = await goToSixWeekMonth(page);

    await expect(page.getByTestId('month-week')).toHaveCount(6);
    // The last day of the month is in the grid — it used to be missing on screen.
    await expect(page.locator(`[data-date="${lastDayOfMonth(year, month)}"]`)).toHaveCount(1);
  });

  test('the last week is reachable by scrolling when the window is too short', async ({ page, request }) => {
    await page.setViewportSize(SHORT_VIEWPORT);
    await registerAndLogin(request, page);
    const { year, month } = await goToSixWeekMonth(page);

    const grid = page.getByTestId('month-grid');
    const lastDay = page.locator(`[data-date="${lastDayOfMonth(year, month)}"]`);

    // Weeks keep their full height and the grid overflows rather than crushing them.
    const overflow = await grid.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow, 'six full-height weeks should overflow a 560px window').toBeGreaterThan(0);

    // Off screen to begin with — that part matches the bug report.
    await expect(lastDay).not.toBeInViewport();

    // Scroll the way a user would. A wheel over an `overflow: hidden` box does
    // nothing, so this is what fails on the unfixed grid; `scrollIntoView` would
    // pass either way because programmatic scrolling works on a clipped box too.
    await grid.hover();
    await page.mouse.wheel(0, 600);

    await expect(lastDay).toBeInViewport({ timeout: 5_000 });

    // The weekday header stays put while the weeks scroll under it.
    await expect(page.getByTestId('month-week-header')).toBeInViewport();
  });

  test('a tall window shows all six weeks with no scrolling at all', async ({ page, request }) => {
    await page.setViewportSize(TALL_VIEWPORT);
    await registerAndLogin(request, page);
    const { year, month } = await goToSixWeekMonth(page);

    const grid = page.getByTestId('month-grid');
    // Weeks grow into the spare height instead of leaving the grid scrollable.
    const overflow = await grid.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow, 'six weeks fit a 1000px window, so nothing should scroll').toBeLessThanOrEqual(1);

    await expect(page.locator(`[data-date="${lastDayOfMonth(year, month)}"]`)).toBeInViewport();
  });
});
