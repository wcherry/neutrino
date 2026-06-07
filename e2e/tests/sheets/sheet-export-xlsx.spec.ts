import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `sheets_xlsx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'XLSX Export Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function openNewSheet(page: Page): Promise<void> {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Spreadsheet' }).click();
  await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 15_000 });
}

async function setCell(page: Page, ref: string, value: string): Promise<void> {
  await page.locator(`[data-type="cell"][id="${ref}"]`).click();
  const formulaInput = page.getByTestId('formula-bar-input');
  await formulaInput.fill(value);
  await formulaInput.press('Enter');
}

/** Open hamburger → Export → Microsoft Excel (.xlsx) and wait for the dialog. */
async function openXlsxExportDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('menu').getByText('Export').hover();
  await page.getByText('Microsoft Excel (.xlsx)').click();
  await expect(page.getByText('Export as Excel')).toBeVisible({ timeout: 5_000 });
}

/** Insert a chart with default settings and wait for it to appear on the sheet. */
async function insertDefaultChart(page: Page): Promise<void> {
  await page.getByTitle('Insert Chart').click();
  await expect(page.getByText('Insert Chart', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('insert-chart-submit').click();
  await expect(page.locator('[class*="chartFrame"]').first()).toBeVisible({ timeout: 8_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Sheets XLSX export', () => {

  test('opening the export dialog shows the correct options', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await openXlsxExportDialog(page);

    // Dialog title
    await expect(page.getByText('Export as Excel')).toBeVisible();
    // Filename input is pre-populated (scoped to the dialog to avoid hidden file inputs on the page)
    const filenameInput = page.locator('[class*="dialogBox"] input:not([type="checkbox"])');
    await expect(filenameInput).toBeVisible();
    await expect(filenameInput).not.toHaveValue('');
    // .xlsx extension label
    await expect(page.getByText('.xlsx')).toBeVisible();
    // Export all sheets checkbox
    await expect(page.getByText('Export all sheets')).toBeVisible();
    // Action buttons
    await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('exporting an empty sheet produces a valid xlsx download', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await openXlsxExportDialog(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
    const path = await download.path();
    expect(path).toBeTruthy();

    // XLSX is a ZIP — magic bytes are PK (0x50 0x4B)
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4B); // 'K'

    // Dialog must close after export
    await expect(page.getByText('Export as Excel')).not.toBeVisible({ timeout: 5_000 });
  });

  test('exporting a sheet with data produces a non-empty valid xlsx file', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    // Populate some data across rows and columns
    await setCell(page, 'A1', 'Month');
    await setCell(page, 'B1', 'Revenue');
    await setCell(page, 'C1', 'Expenses');
    await setCell(page, 'A2', 'January');
    await setCell(page, 'B2', '12000');
    await setCell(page, 'C2', '8000');
    await setCell(page, 'A3', 'February');
    await setCell(page, 'B3', '15000');
    await setCell(page, 'C3', '9500');

    await openXlsxExportDialog(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);

    // Valid XLSX (ZIP) signature
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4B);
    // File with cell data should be meaningfully larger than an empty workbook
    expect(bytes.length).toBeGreaterThan(2_000);
  });

  test('cancelling the export dialog does not trigger a download', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await setCell(page, 'A1', 'Cancel test');

    await openXlsxExportDialog(page);
    await expect(page.getByText('Export as Excel')).toBeVisible({ timeout: 3_000 });

    let downloadFired = false;
    page.once('download', () => { downloadFired = true; });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Export as Excel')).not.toBeVisible({ timeout: 3_000 });

    await page.waitForTimeout(500);
    expect(downloadFired).toBe(false);
  });

  test('the filename can be changed before exporting', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await setCell(page, 'A1', 'Custom filename test');

    await openXlsxExportDialog(page);

    const filenameInput = page.locator('[class*="dialogBox"] input:not([type="checkbox"])');
    await filenameInput.clear();
    await filenameInput.fill('my-custom-export');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('my-custom-export.xlsx');
  });

  test('with a single sheet the Sheet selector is visible and all-sheets is unchecked', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await openXlsxExportDialog(page);

    // Single sheet → allSheets defaults to false → Sheet selector is shown
    const sheetLabel = page.getByText('Sheet', { exact: true });
    await expect(sheetLabel).toBeVisible();

    // "Export all sheets" checkbox should be unchecked
    const exportAllLabel = page.locator('label').filter({ hasText: 'Export all sheets' });
    const checkbox = exportAllLabel.locator('input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();
  });

  test('checking Export all sheets hides the Sheet selector', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await openXlsxExportDialog(page);

    // Verify Sheet selector is initially visible
    await expect(page.getByText('Sheet', { exact: true })).toBeVisible();

    // Check the "Export all sheets" checkbox
    const exportAllLabel = page.locator('label').filter({ hasText: 'Export all sheets' });
    await exportAllLabel.locator('input[type="checkbox"]').check();

    // Sheet selector must disappear
    await expect(page.getByText('Sheet', { exact: true })).not.toBeVisible({ timeout: 3_000 });
  });

});

// ── XLSX export with charts ───────────────────────────────────────────────────

test.describe('Sheets XLSX export with charts', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/feature-flags', async route => {
      const response = await route.fetch();
      const flags = await response.json();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ...flags, sheetsCharts: true }),
      });
    });
  });

  test('a sheet with a chart exports its cell data to xlsx successfully', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    // Add chart source data
    await setCell(page, 'A1', 'Quarter');
    await setCell(page, 'B1', 'Sales');
    await setCell(page, 'A2', 'Q1');
    await setCell(page, 'B2', '4200');
    await setCell(page, 'A3', 'Q2');
    await setCell(page, 'B3', '5800');
    await setCell(page, 'A4', 'Q3');
    await setCell(page, 'B4', '7100');

    // Insert a chart bound to the data range
    await page.getByTitle('Insert Chart').click();
    await expect(page.getByText('Insert Chart', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    const rangeInput = page.getByPlaceholder('e.g. A1:D10');
    await rangeInput.fill('A1:B4');
    await page.getByTestId('insert-chart-submit').click();
    await expect(page.locator('[class*="chartFrame"]').first()).toBeVisible({ timeout: 8_000 });

    await openXlsxExportDialog(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);

    // Valid XLSX signature
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4B);
    expect(bytes.length).toBeGreaterThan(2_000);

    await expect(page.getByText('Export as Excel')).not.toBeVisible({ timeout: 5_000 });
  });

  test('a sheet with multiple chart types exports cell data to xlsx', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    // Populate data for two charts
    await setCell(page, 'A1', 'Category');
    await setCell(page, 'B1', 'Value');
    await setCell(page, 'A2', 'Alpha');
    await setCell(page, 'B2', '30');
    await setCell(page, 'A3', 'Beta');
    await setCell(page, 'B3', '50');
    await setCell(page, 'A4', 'Gamma');
    await setCell(page, 'B4', '20');

    // Insert first chart (column — default)
    await insertDefaultChart(page);
    // Deselect
    await page.locator('[data-type="cell"][id="A1"]').click();

    // Insert second chart (pie)
    await page.getByTitle('Insert Chart').click();
    await expect(page.getByText('Insert Chart', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Pie' }).click();
    await page.getByTestId('insert-chart-submit').click();
    await expect(page.locator('[class*="chartFrame"]')).toHaveCount(2, { timeout: 8_000 });

    await openXlsxExportDialog(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4B);
    expect(bytes.length).toBeGreaterThan(2_000);
  });

  test('cancelling xlsx export from a chart-containing sheet does not download', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await setCell(page, 'A1', '10');
    await setCell(page, 'B1', '20');

    await insertDefaultChart(page);
    await page.locator('[data-type="cell"][id="A1"]').click();

    await openXlsxExportDialog(page);

    let downloadFired = false;
    page.once('download', () => { downloadFired = true; });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Export as Excel')).not.toBeVisible({ timeout: 3_000 });

    await page.waitForTimeout(500);
    expect(downloadFired).toBe(false);
  });
});
