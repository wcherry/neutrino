import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `diagrams_io_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'IO Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function createDiagramAndOpenEditor(
  request: APIRequestContext,
  page: Page,
): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found');
  const res = await request.post(`${BASE_URL}/api/v1/diagrams`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title: 'IO Test Diagram' },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const { id } = await res.json() as { id: string };
  await page.goto(`/diagrams/editor?id=${id}`);
  await expect(page.getByTitle('Select (V)')).toBeVisible({ timeout: 15_000 });
  return id;
}

test.describe('Diagram import/export', () => {
  test('export dialog opens and lists all format options', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Export diagram').click();

    await expect(page.getByText('PNG — Raster image, transparent background')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText('SVG — Scalable vector graphic')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('JSON — Neutrino diagram format')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('Mermaid — Flowchart text')).toBeVisible({ timeout: 3_000 });
  });

  test('export dialog can be closed', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Export diagram').click();
    await expect(page.getByText('PNG — Raster image, transparent background')).toBeVisible({
      timeout: 5_000,
    });

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(page.getByText('PNG — Raster image, transparent background')).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test('export dialog shows raster size options for PNG', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Export diagram').click();
    await expect(page.getByText('PNG — Raster image, transparent background')).toBeVisible({
      timeout: 5_000,
    });

    // Select PNG format (should already be selected by default or click it)
    const pngOption = page.locator('label, [type="radio"]').filter({
      hasText: 'PNG',
    }).first();
    await pngOption.click();

    await expect(page.getByText('XL — 6× resolution')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('Large — 4× resolution')).toBeVisible({ timeout: 3_000 });
  });

  test('JSON export triggers a download', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    // Add a shape so the export is non-trivial
    await page.getByTitle('Rectangle').first().click();

    await page.getByTitle('Export diagram').click();
    await expect(page.getByText('JSON — Neutrino diagram format')).toBeVisible({ timeout: 5_000 });

    // Select the JSON format
    const jsonOption = page.getByLabel('JSON — Neutrino diagram format');
    if (await jsonOption.count() > 0) {
      await jsonOption.check();
    } else {
      await page.getByText('JSON — Neutrino diagram format').click();
    }

    // Wait for a download event when clicking Export
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      page.getByRole('button', { name: /export/i }).last().click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.json$/);
  });

  test('import dialog opens with File and Paste tabs', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Import diagram').click();

    await expect(page.getByRole('tab', { name: 'File' }).or(page.getByText('File')).first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByRole('tab', { name: 'Paste' }).or(page.getByText('Paste')).first()).toBeVisible({
      timeout: 3_000,
    });
  });

  test('import dialog can be closed without importing', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Import diagram').click();
    await expect(page.getByText('Paste')).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(page.getByText('Paste')).not.toBeVisible({ timeout: 5_000 });
  });

  test('Mermaid paste import creates shapes on the canvas', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Import diagram').click();

    // Switch to the Paste tab
    await page.getByText('Paste').click();

    const textarea = page.getByRole('textbox').last();
    await expect(textarea).toBeVisible({ timeout: 5_000 });

    const mermaidCode = `graph LR
  A[Start] --> B[Process]
  B --> C[End]`;
    await textarea.fill(mermaidCode);

    await page.getByRole('button', { name: 'Import', exact: true }).click();

    // After import the dialog closes and shapes appear on the canvas
    await expect(page.getByText('Paste')).not.toBeVisible({ timeout: 5_000 });
    // At least one shape label should appear in the canvas SVG
    await expect(page.locator('svg text').first()).toBeVisible({ timeout: 5_000 });
  });
});
