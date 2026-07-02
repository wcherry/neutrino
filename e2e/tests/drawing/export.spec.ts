import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `drawing_export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
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
}

async function openEditorWithShape(request: APIRequestContext, page: Page): Promise<void> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found');
  const res = await request.post(`${BASE_URL}/api/v1/drawing`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title: 'Export Test Drawing' },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const { id } = await res.json() as { id: string };
  await page.goto(`/drawing/editor?id=${id}`);
  await expect(page.getByLabel('Drawing title')).toBeVisible({ timeout: 15_000 });

  // Draw a rectangle so the export button is enabled (requires at least 1 shape)
  await page.getByLabel('Rectangle').click();
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160, { steps: 10 });
  await page.mouse.up();
  // Switch back to select tool
  await page.getByLabel('Select').click();
}

async function openExportDialog(page: Page): Promise<void> {
  // Open the hamburger menu (aria-label="Open menu"), hover the "File" submenu, then click Export…
  await page.getByLabel('Open menu').click();
  const fileSubmenu = page.getByRole('menu').getByText('File').first();
  await fileSubmenu.hover();
  await page.getByText('Export…').click();
  await expect(page.getByText('Export Drawing')).toBeVisible({ timeout: 5_000 });
}

test.describe('Export flow', () => {
  test('export dialog opens and shows format options', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditorWithShape(request, page);
    await openExportDialog(page);

    await expect(page.getByLabel('Format')).toBeVisible({ timeout: 5_000 });
    const formatSelect = page.getByLabel('Format');
    await expect(formatSelect).toContainText('PNG');
    await expect(formatSelect).toContainText('SVG');
  });

  test('cancel button closes the export dialog', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditorWithShape(request, page);
    await openExportDialog(page);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Export Drawing')).not.toBeVisible({ timeout: 5_000 });
  });

  test('clicking outside the dialog closes it', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditorWithShape(request, page);
    await openExportDialog(page);

    // Click on the overlay (outside the dialog box)
    await page.mouse.click(10, 10);
    await expect(page.getByText('Export Drawing')).not.toBeVisible({ timeout: 5_000 });
  });

  test('PNG export triggers a file download', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditorWithShape(request, page);
    await openExportDialog(page);

    // Ensure PNG is selected
    await page.getByLabel('Format').selectOption('png');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.png$/);
  });

  test('SVG export triggers a file download', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditorWithShape(request, page);
    await openExportDialog(page);

    await page.getByLabel('Format').selectOption('svg');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.svg$/);
  });

  test('filename field defaults to the drawing title', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditorWithShape(request, page);
    await openExportDialog(page);

    // The ExportDialog sanitises the title, replacing non-alphanumeric chars with underscores
    const filenameInput = page.getByLabel('Filename');
    await expect(filenameInput).toHaveValue('Export_Test_Drawing', { timeout: 5_000 });
  });

  test('changing the filename changes the downloaded file name', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditorWithShape(request, page);
    await openExportDialog(page);

    await page.getByLabel('Format').selectOption('png');
    await page.getByLabel('Filename').fill('my_export');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('my_export.png');
  });

  test('export button is disabled when the canvas has no shapes', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    if (!token) throw new Error('access_token not found');
    const res = await request.post(`${BASE_URL}/api/v1/drawing`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { title: 'Empty Drawing' },
    });
    const { id } = await res.json() as { id: string };
    await page.goto(`/drawing/editor?id=${id}`);
    await expect(page.getByLabel('Drawing title')).toBeVisible({ timeout: 15_000 });

    await openExportDialog(page);
    await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled({ timeout: 5_000 });
  });
});
