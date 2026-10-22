/**
 * Drive in the new looks, and the first user settings that reach every screen — UI roadmap stage 4
 * (agent_docs/ui-roadmap.md): Drive's regions and list (LF4), density, text size, accent and the
 * accessibility switches (U2, U3, U5), the user's sidebar (U8) and default views (U9).
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page, prefix: string): Promise<{ email: string; token: string }> {
  const email = uniqueEmail(prefix);
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Drive Look Test', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
  return { email, token: (await page.evaluate(() => localStorage.getItem('access_token')))! };
}

async function setPrefs(request: APIRequestContext, token: string, values: Record<string, unknown>): Promise<void> {
  const res = await request.patch(`${BASE_URL}/api/v1/preferences`, {
    data: { values },
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `preferences: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function createFolder(request: APIRequestContext, token: string, name: string): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/folders`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { name },
  });
  expect(res.ok(), `create folder failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

test.describe('Drive in the new looks', () => {
  test('Quick access and Files are regions, the title is the folder, and the list is the default view', async ({ page, request }) => {
    const { token } = await registerAndLogin(request, page, 'drive_look');
    await createFolder(request, token, 'Quarterly planning');
    await setPrefs(request, token, { 'appearance.look': 'precision' });
    await page.goto('/drive');
    await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'My Drive' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Detailed list' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('listitem', { name: 'Quarterly planning' })).toBeVisible();
  });

  test('rows follow the density, and text follows the text size', async ({ page, request }) => {
    const { token } = await registerAndLogin(request, page, 'drive_density');
    await createFolder(request, token, 'Density folder');
    await setPrefs(request, token, { 'appearance.look': 'lightflow' });
    const rowHeight = async () => {
      await page.goto('/drive');
      const row = page.getByRole('listitem', { name: 'Density folder' });
      await expect(row).toBeVisible();
      return Math.round((await row.boundingBox())!.height);
    };
    await page.goto('/settings?tab=appearance');
    await page.getByRole('radiogroup', { name: 'Density' }).getByRole('radio', { name: 'Compact' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
    expect(await rowHeight()).toBe(34);
    await page.goto('/settings?tab=appearance');
    await page.getByRole('radiogroup', { name: 'Density' }).getByRole('radio', { name: 'Spacious' }).click();
    expect(await rowHeight()).toBe(54);

    await page.goto('/settings?tab=appearance');
    await page.getByRole('radiogroup', { name: 'Text size' }).getByRole('radio', { name: 'Large' }).click();
    await expect(page.locator('html')).toHaveCSS('font-size', '18px');
    // Before first paint on the next load too.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-text-size', 'lg');
  });
});

test.describe('Display settings', () => {
  test('an accent too light to read is drawn darker, and the stored colour is the one picked', async ({ page, request }) => {
    const { token } = await registerAndLogin(request, page, 'accent');
    await setPrefs(request, token, { 'appearance.look': 'lightflow', 'appearance.theme': 'light', 'appearance.accent': '#ffd400' });
    await page.goto('/drive');
    const drawn = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-accent').trim());
    expect(drawn).not.toBe('#ffd400');
    expect(drawn).toMatch(/^#[0-9a-f]{6}$/);
    const prefs = await (await request.get(`${BASE_URL}/api/v1/preferences`, { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(prefs.values['appearance.accent']).toBe('#ffd400');
    // Painted before React on the next load.
    await page.reload();
    await expect(page.locator('#neutrino-accent')).toHaveCount(1);
  });

  test('reduce transparency and higher contrast set their attributes', async ({ page, request }) => {
    await registerAndLogin(request, page, 'a11y');
    await page.goto('/settings?tab=appearance');
    await page.getByRole('radiogroup', { name: 'Reduce transparency' }).getByRole('radio', { name: 'On' }).click();
    await page.getByRole('radiogroup', { name: 'Higher contrast' }).getByRole('radio', { name: 'On' }).click();
    await page.getByRole('radiogroup', { name: 'Reduce motion' }).getByRole('radio', { name: 'On' }).click();
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-transparency', 'off');
    await expect(html).toHaveAttribute('data-contrast', 'more');
    await expect(html).toHaveAttribute('data-reduce-motion', 'on');
  });
});

test.describe('The user\'s sidebar and views', () => {
  test('a folder pinned from its menu appears under the Drive views and opens', async ({ page, request }) => {
    const { token } = await registerAndLogin(request, page, 'pin');
    await createFolder(request, token, 'Pinned taxes');
    await page.goto('/drive');
    await page.getByLabel('More options for Pinned taxes').click();
    await page.getByRole('menuitem', { name: 'Pin to sidebar' }).click();
    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    await nav.getByRole('link', { name: 'Pinned taxes' }).click();
    await expect(page).toHaveURL(/folder=/);
    await expect(page.getByText('Pinned taxes').first()).toBeVisible();
  });

  test('hiding an entry in Settings takes it out of the sidebar, and it stays hidden after a reload', async ({ page, request }) => {
    await registerAndLogin(request, page, 'hide');
    await page.goto('/settings?tab=appearance');
    await page.getByRole('group', { name: 'Drive' }).getByRole('checkbox', { name: 'Trash' }).uncheck();
    await page.getByRole('group', { name: 'Apps' }).getByRole('checkbox', { name: 'Photos' }).uncheck();
    await page.goto('/drive');
    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(nav.getByRole('link', { name: 'Trash' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Photos' })).toHaveCount(0);
    await page.reload();
    await expect(nav.getByRole('link', { name: 'Docs' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Trash' })).toHaveCount(0);
  });

  test('a listing remembers its view, on another device too', async ({ page, request, browser }) => {
    const { email } = await registerAndLogin(request, page, 'views');
    await page.goto('/drive/recent');
    await page.getByRole('button', { name: 'Small grid' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Small grid' })).toHaveAttribute('aria-pressed', 'true');

    // The same user on a second browser: the choice followed them.
    const other = await (await browser.newContext()).newPage();
    await other.goto(`${BASE_URL}/sign-in`);
    await other.getByLabel('Email').fill(email);
    await other.getByLabel('Password').fill(PASSWORD);
    await other.getByRole('button', { name: 'Sign in' }).click();
    await expect(other).toHaveURL(/\/drive/, { timeout: 15_000 });
    await other.goto(`${BASE_URL}/drive/recent`);
    await expect(other.getByRole('button', { name: 'Small grid' })).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await other.close();
  });

  test('Drive opens on the chosen page, once per tab', async ({ page, request, browser }) => {
    const { email, token } = await registerAndLogin(request, page, 'landing');
    await setPrefs(request, token, { 'drive.landing': 'recent' });
    const tab = await (await browser.newContext()).newPage();
    await tab.goto(`${BASE_URL}/sign-in`);
    await tab.getByLabel('Email').fill(email);
    await tab.getByLabel('Password').fill(PASSWORD);
    await tab.getByRole('button', { name: 'Sign in' }).click();
    await expect(tab).toHaveURL(/\/drive\/recent/, { timeout: 15_000 });
    // After that, My Drive is My Drive.
    await tab.goto(`${BASE_URL}/drive`);
    await expect(tab).toHaveURL(/\/drive\/?$/);
    await tab.close();
  });
});
