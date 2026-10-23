/**
 * Corners and the interface font — the last two theme dimensions (customization roadmap §3.3,
 * UI roadmap stage 6). Both reach every screen through tokens and are applied before first paint.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';

async function signUp(page: Page, request: import('@playwright/test').APIRequestContext): Promise<void> {
  const email = `shape_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Shape Test', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok()).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
}

/** What `--radius-md` resolves to here, in px — the radius most controls are drawn with. */
const mediumRadius = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.borderRadius = 'var(--radius-md)';
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).borderTopLeftRadius);
    probe.remove();
    return px;
  });

test.describe('Corners and interface font', () => {
  test('sharper corners halve the radii, and survive a reload before paint', async ({ page, request }) => {
    await signUp(page, request);
    await page.goto('/settings?tab=appearance');
    const before = await mediumRadius(page);
    await page.getByRole('radiogroup', { name: 'Corners' }).getByRole('radio', { name: 'Sharper' }).click();
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-shape', 'sharper');
    expect(await mediumRadius(page)).toBeCloseTo(before / 2, 1);
    await page.reload();
    await expect(html).toHaveAttribute('data-shape', 'sharper');

    await page.getByRole('radiogroup', { name: 'Corners' }).getByRole('radio', { name: 'Rounder' }).click();
    expect(await mediumRadius(page)).toBeCloseTo(before * 1.75, 1);
    await page.getByRole('radiogroup', { name: 'Corners' }).getByRole('radio', { name: 'Default' }).click();
    await expect(html).not.toHaveAttribute('data-shape', /.+/);
    expect(await mediumRadius(page)).toBeCloseTo(before, 1);
  });

  test('a chosen interface font becomes the UI font everywhere, and Look’s own removes it', async ({ page, request }) => {
    await signUp(page, request);
    await page.goto('/settings?tab=appearance');
    const select = page.getByLabel('Interface font');
    const option = await select.locator('option').nth(1).getAttribute('value');
    expect(option).toBeTruthy();
    await select.selectOption(option!);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain(option!);
    await page.goto('/drive');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain(option!);
    await page.goto('/settings?tab=appearance');
    await page.getByLabel('Interface font').selectOption('');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Inter');
  });
});
