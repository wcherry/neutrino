/**
 * Onboarding phase 1: the Drive tour (agent_docs/plans/feature-onboarding.md).
 *
 * Tours do not start by themselves under browser automation — Playwright sets `navigator.webdriver`,
 * and every other spec would otherwise find a tour over the page it is testing. This spec asks for
 * them with the device-local override (`neutrino.tours.autoStart = on`) before the app loads.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';

const STEPS = [
  'Create anything from here',
  'Quick access',
  'Quick filters',
  'Display mode',
  'Search, notifications and you',
  'Your storage',
];

function uniqueEmail(): string {
  return `tour_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<string> {
  const email = uniqueEmail();
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Tour Test User', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
  return (await page.evaluate(() => localStorage.getItem('access_token')))!;
}

async function toursSeen(request: APIRequestContext, token: string): Promise<unknown> {
  const res = await request.get(`${BASE_URL}/api/v1/preferences`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { values: Record<string, unknown> }).values['onboarding.toursSeen'];
}

function tour(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Drive tour' });
}

/** Long enough for a tour that was going to start by itself to have done so. */
async function expectNoTour(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_500);
  await expect(tour(page)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('neutrino.tours.autoStart', 'on'));
});

test.describe('Drive tour', () => {
  test('starts by itself after the encryption gate, walks every step, and does not come back', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);

    const card = tour(page);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText(`1 of ${STEPS.length}`);
    await expect(card).toContainText(STEPS[0]);
    await expect(card.getByRole('button', { name: 'Back' })).toBeDisabled();
    // Focus moves into the card.
    await expect(card.getByRole('button', { name: 'Next' })).toBeFocused();

    for (let i = 1; i < STEPS.length; i++) {
      await card.getByRole('button', { name: 'Next' }).click();
      await expect(card).toContainText(`${i + 1} of ${STEPS.length}`);
      await expect(card).toContainText(STEPS[i]);
    }
    // Back, then forward again with the keyboard.
    await card.getByRole('button', { name: 'Back' }).click();
    await expect(card).toContainText(`${STEPS.length - 1} of ${STEPS.length}`);
    await page.keyboard.press('ArrowRight');
    await expect(card).toContainText(`${STEPS.length} of ${STEPS.length}`);

    await card.getByRole('button', { name: 'Done' }).click();
    await expect(card).toHaveCount(0);
    await expect.poll(() => toursSeen(request, token), { timeout: 10_000 }).toEqual(['drive']);

    await page.reload();
    await expectNoTour(page);
  });

  test('Skip tour ends it for good', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    await expect(tour(page)).toBeVisible({ timeout: 15_000 });
    await tour(page).getByRole('button', { name: 'Skip tour' }).click();
    await expect(tour(page)).toHaveCount(0);
    await expect.poll(() => toursSeen(request, token), { timeout: 10_000 }).toEqual(['drive']);

    await page.reload();
    await expectNoTour(page);
  });

  test('Esc skips it', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    await expect(tour(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(tour(page)).toHaveCount(0);
    await expect.poll(() => toursSeen(request, token), { timeout: 10_000 }).toEqual(['drive']);
  });

  test('replays from the account menu in the classic look and in Blended', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    await expect(tour(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect.poll(() => toursSeen(request, token), { timeout: 10_000 }).toEqual(['drive']);

    // Classic: the user menu in the top bar.
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: 'Take the Drive tour' }).click();
    await expect(tour(page)).toContainText(`1 of ${STEPS.length}`);
    await page.keyboard.press('Escape');
    await expect(tour(page)).toHaveCount(0);

    // Blended: the account menu, replayed from another Drive page, comes back to My Drive.
    const res = await request.patch(`${BASE_URL}/api/v1/preferences`, {
      data: { values: { 'appearance.look': 'blended' } },
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBeTruthy();
    await page.goto('/drive/recent');
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Take the Drive tour' }).click();
    await expect(page).toHaveURL(/\/drive\/?$/);
    await expect(tour(page)).toContainText(`1 of ${STEPS.length}`);
    await expect(tour(page)).toContainText(STEPS[0]);
  });

  test('leaves out what is not on screen and counts only what it shows', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    await expect(tour(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect.poll(() => toursSeen(request, token), { timeout: 10_000 }).toEqual(['drive']);

    // A collapsed sidebar has no storage meter, so the tour is one step shorter.
    const res = await request.patch(`${BASE_URL}/api/v1/preferences`, {
      data: { values: { 'appearance.look': 'blended' } },
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBeTruthy();
    await page.reload();
    await page.getByRole('button', { name: /Collapse sidebar/i }).click();
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Take the Drive tour' }).click();
    await expect(tour(page)).toContainText(`1 of ${STEPS.length - 1}`);
    for (let i = 1; i < STEPS.length - 1; i++) await page.keyboard.press('ArrowRight');
    await expect(tour(page)).toContainText(STEPS[STEPS.length - 2]);
    await expect(tour(page).getByRole('button', { name: 'Done' })).toBeVisible();
  });
});
