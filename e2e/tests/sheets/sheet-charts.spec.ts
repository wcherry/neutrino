import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `sheets_charts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Charts Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

/** Create a new spreadsheet via the FAB and wait for the editor to be ready. */
async function openNewSheet(page: Page): Promise<void> {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Spreadsheet' }).click();
  await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 15_000 });
}

/** Click a cell, type a value into the formula bar, commit with Enter. */
async function setCell(page: Page, ref: string, value: string): Promise<void> {
  await page.locator(`[data-type="cell"][id="${ref}"]`).click();
  const formulaInput = page.getByTestId('formula-bar-input');
  await formulaInput.fill(value);
  await formulaInput.press('Enter');
}

/** Open the Insert Chart dialog via the toolbar button. */
async function openInsertChartDialog(page: Page): Promise<void> {
  await page.getByTitle('Insert Chart').click();
  await expect(page.getByText('Insert Chart', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
}

/** Insert a chart with default settings and wait for it to appear on the sheet. */
async function insertDefaultChart(page: Page): Promise<void> {
  await openInsertChartDialog(page);
  await page.getByTestId('insert-chart-submit').click();
  // A chart frame is rendered inside the chart layer
  await expect(page.locator('[class*="chartFrame"]').first()).toBeVisible({ timeout: 8_000 });
}

test.describe('Sheets charts', () => {
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

  // ── Insert Chart dialog ──────────────────────────────────────────────────────

  test('clicking Insert Chart toolbar button opens the creation dialog', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await page.getByTitle('Insert Chart').click();

    // The dialog header says "Insert Chart"
    await expect(page.getByText('Insert Chart', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    // Chart type picker is visible — at least the Column button
    await expect(page.getByRole('button', { name: 'Column' })).toBeVisible();
    // Data range input is visible
    await expect(page.getByPlaceholder('e.g. A1:D10')).toBeVisible();
  });

  test('the chart type picker lets you switch to Line before inserting', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await openInsertChartDialog(page);

    // Click the Line type button
    await page.getByRole('button', { name: 'Line' }).click();

    // The Line button should now carry the active CSS class
    const lineBtn = page.getByRole('button', { name: 'Line' });
    await expect(lineBtn).toHaveClass(/chartTypeBtnActive/, { timeout: 3_000 });
  });

  test('closing the dialog with Cancel does not insert a chart', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await openInsertChartDialog(page);
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Dialog must be gone
    await expect(page.getByText('Insert Chart', { exact: true })).not.toBeVisible({ timeout: 3_000 });
    // No chart frame should exist in the DOM
    await expect(page.locator('[class*="chartFrame"]')).toHaveCount(0);
  });

  // ── Inserting a chart ────────────────────────────────────────────────────────

  test('inserting a chart places a chart frame on the sheet', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await insertDefaultChart(page);

    // The dialog must close after insert
    await expect(page.getByTestId('insert-chart-submit')).not.toBeVisible({ timeout: 3_000 });
    // Exactly one chart frame is present
    await expect(page.locator('[class*="chartFrame"]')).toHaveCount(1);
  });

  // ── Selecting a chart ────────────────────────────────────────────────────────

  test('clicking a chart selects it and shows resize handles', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await insertDefaultChart(page);

    const frame = page.locator('[class*="chartFrame"]').first();

    // Click the chart to select it
    await frame.click();

    // The frame should gain the selected CSS class (blue border)
    await expect(frame).toHaveClass(/chartFrameSelected/, { timeout: 5_000 });

    // All 8 resize handles should be visible
    await expect(frame.locator('[data-handle]')).toHaveCount(8);
  });

  test('clicking outside a selected chart deselects it and hides resize handles', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await insertDefaultChart(page);

    const frame = page.locator('[class*="chartFrame"]').first();

    // Select the chart
    await frame.click();
    await expect(frame).toHaveClass(/chartFrameSelected/, { timeout: 5_000 });

    // Click a cell outside the chart layer to deselect
    await page.locator('[data-type="cell"][id="A1"]').click();

    // The selected class must be gone, so no resize handles remain
    await expect(frame).not.toHaveClass(/chartFrameSelected/, { timeout: 5_000 });
    await expect(frame.locator('[data-handle]')).toHaveCount(0);
  });

  // ── Chart editor panel ───────────────────────────────────────────────────────

  test('selecting a chart opens the Chart editor panel', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await insertDefaultChart(page);

    // Click the chart to select it
    await page.locator('[class*="chartFrame"]').first().click();

    // The side panel should appear
    await expect(page.getByText('Chart', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    // The "Delete Chart" button inside the panel should be visible
    await expect(page.getByRole('button', { name: 'Delete Chart' })).toBeVisible({ timeout: 5_000 });
  });

  test('closing the chart editor panel via X deselects the chart', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await insertDefaultChart(page);

    // Select the chart to open the panel
    await page.locator('[class*="chartFrame"]').first().click();
    await expect(page.getByRole('button', { name: 'Delete Chart' })).toBeVisible({ timeout: 5_000 });

    // Close the panel
    await page.getByRole('button', { name: 'Close chart editor' }).click();

    // The editor panel must be gone (no Delete Chart button)
    await expect(page.getByRole('button', { name: 'Delete Chart' })).not.toBeVisible({ timeout: 3_000 });

    // The chart frame itself must still be present (only the panel closed)
    await expect(page.locator('[class*="chartFrame"]')).toHaveCount(1);
  });

  // ── Deleting a chart ─────────────────────────────────────────────────────────

  test('deleting a selected chart via the editor panel removes it from the sheet', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    await insertDefaultChart(page);

    // Select the chart
    await page.locator('[class*="chartFrame"]').first().click();
    await expect(page.getByRole('button', { name: 'Delete Chart' })).toBeVisible({ timeout: 5_000 });

    // Delete via the panel button
    await page.getByRole('button', { name: 'Delete Chart' }).click();

    // The chart frame and the editor panel must both disappear
    await expect(page.locator('[class*="chartFrame"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Delete Chart' })).not.toBeVisible({ timeout: 3_000 });
  });

  // ── Data binding ─────────────────────────────────────────────────────────────

  test('the chart updates when the source cell data changes', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewSheet(page);

    // Populate a small data range to use as chart source
    await setCell(page, 'A1', 'Month');
    await setCell(page, 'B1', 'Sales');
    await setCell(page, 'A2', 'Jan');
    await setCell(page, 'B2', '100');
    await setCell(page, 'A3', 'Feb');
    await setCell(page, 'B3', '200');

    // Open the dialog and set the data range explicitly
    await page.getByTitle('Insert Chart').click();
    await expect(page.getByText('Insert Chart', { exact: true }).first()).toBeVisible({ timeout: 5_000 });

    const rangeInput = page.getByPlaceholder('e.g. A1:D10');
    await rangeInput.fill('A1:B3');
    await page.getByTestId('insert-chart-submit').click();

    // Chart frame is on screen
    await expect(page.locator('[class*="chartFrame"]').first()).toBeVisible({ timeout: 8_000 });

    // Capture the initial chart SVG/canvas content for comparison
    const frameLocator = page.locator('[class*="chartFrame"]').first();
    const contentBefore = await frameLocator.innerHTML();

    // Update a cell value so the chart data changes
    await setCell(page, 'B2', '999');

    // Give React a moment to propagate the state update and re-render the chart
    await page.waitForTimeout(500);

    // The chart should have re-rendered with new content
    const contentAfter = await frameLocator.innerHTML();
    expect(contentAfter).not.toEqual(contentBefore);
  });
});
