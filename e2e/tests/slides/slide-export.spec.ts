import { readFileSync } from 'node:fs';
import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `slides_export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Export Test User', email, password },
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

// ── Export ────────────────────────────────────────────────────────────────────

test.describe('Presentation export', () => {
  test('Export → PowerPoint triggers a .pptx download', async ({ page, request }) => {
    await registerAndLogin(request, page);

    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Presentation' }).click();
    await expect(page).toHaveURL(/\/slides\/editor\/?\?id=/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Slides' })).toBeVisible({ timeout: 10_000 });

    // Register the download listener before triggering the export.
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });

    await page.getByRole('button', { name: /Export/ }).click();
    await page.getByText('PowerPoint (.pptx)').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pptx$/);
  });

  test('exported .pptx filename reflects the presentation title', async ({ page, request }) => {
    await registerAndLogin(request, page);

    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Presentation' }).click();
    await expect(page).toHaveURL(/\/slides\/editor\/?\?id=/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Slides' })).toBeVisible({ timeout: 10_000 });

    // Rename the presentation.
    const titleInput = page.getByPlaceholder('Untitled presentation');
    await titleInput.fill('Q4 Review');
    const titleSaved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/drive/files/') && r.request().method() === 'PATCH',
      { timeout: 10_000 },
    );
    await titleInput.blur();
    await titleSaved;

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });

    await page.getByRole('button', { name: /Export/ }).click();
    await page.getByText('PowerPoint (.pptx)').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/Q4 Review.*\.pptx$/i);
  });

  test('Export → PDF downloads a PDF of the slides (issue #100)', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page);

    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Presentation' }).click();
    await expect(page).toHaveURL(/\/slides\/editor\/?\?id=/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Slides' })).toBeVisible({ timeout: 10_000 });

    // A shape as well as the layout's text, so the export's SVG path is
    // exercised in a real browser and not only in the unit tests.
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menu').getByText('Insert', { exact: true }).hover();
    await page.getByText('General', { exact: true }).hover();
    await page.getByText('Rectangle', { exact: true }).click();

    const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });
    await page.getByRole('button', { name: /Export/ }).click();
    await page.getByText('PDF (.pdf)').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

    const path = await download.path();
    expect(path).toBeTruthy();
    const bytes = readFileSync(path!);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1_000);
  });
});
