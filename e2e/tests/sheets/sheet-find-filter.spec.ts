import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix = 'findfilter'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page, prefix = 'findfilter'): Promise<void> {
  const email = uniqueEmail(prefix);
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Test User', email, password },
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

/** Click a cell, type value into formula bar, press Enter to commit. */
async function setCell(page: Page, ref: string, value: string): Promise<void> {
  await page.locator(`[data-type="cell"][id="${ref}"]`).click();
  const formulaInput = page.getByTestId('formula-bar-input');
  await formulaInput.fill(value);
  await formulaInput.press('Enter');
}

/** Assert a cell's displayed span text. */
async function expectCell(page: Page, ref: string, expected: string): Promise<void> {
  await expect(page.locator(`[data-type="cell"][id="${ref}"] span`)).toHaveText(expected, { timeout: 8_000 });
}

/**
 * Right-click the column header for a given letter (e.g. "A").
 *
 * The SheetGrid renders column headers as absolutely-positioned divs above the
 * scrollable body, at the same horizontal position as the data cells.  There
 * are no stable data-attributes on these header divs, so we derive the click
 * coordinates from the first data cell in that column:
 *   x = horizontal centre of the first data cell in the column
 *   y = a point in the header strip (COL_HDR_H = 24px, so y = 12 works)
 */
async function rightClickColHeader(page: Page, letter: string): Promise<void> {
  // Use the first cell in the target column (row 1) to get the x centre.
  const firstCell = page.locator(`[data-type="cell"][id="${letter}1"]`);
  await firstCell.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await firstCell.boundingBox();
  if (!box) throw new Error(`Could not get bounding box for cell ${letter}1`);

  // The column header sits above the body.  The header strip height is 24px
  // (COL_HDR_H constant in SheetGrid).  Click at the vertical midpoint of the
  // header strip, which is at y = box.y - box.height/2 approximately.
  // More reliably: use the cell's x centre and click 12px above the cell top.
  const x = box.x + box.width / 2;
  const y = box.y - 12; // 12px above the cell top lands inside the 24px header strip

  await page.mouse.click(x, y, { button: 'right' });
}

// ── Find dialog ───────────────────────────────────────────────────────────────

test.describe('Find dialog', () => {
  test('opens with Ctrl+F and shows the Find dialog', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'find1');
    await openNewSheet(page);

    await page.keyboard.press('Control+f');

    await expect(page.getByText('Find', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('finds matching cells and shows match count', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'find2');
    await openNewSheet(page);

    await setCell(page, 'A1', 'apple');
    await setCell(page, 'A2', 'banana');
    await setCell(page, 'A3', 'apple');

    await page.keyboard.press('Control+f');
    await expect(page.getByPlaceholder('Find…')).toBeVisible({ timeout: 5_000 });

    await page.getByPlaceholder('Find…').fill('apple');

    // First match: "1 of 2"
    await expect(page.locator('span').filter({ hasText: /^1 of 2$/ })).toBeVisible({ timeout: 8_000 });

    // Navigate to next match using the ↓ button
    await page.getByTitle('Next match (Enter)').click();

    // Second match: "2 of 2"
    await expect(page.locator('span').filter({ hasText: /^2 of 2$/ })).toBeVisible({ timeout: 8_000 });
  });

  test('shows No matches for unmatched search', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'find3');
    await openNewSheet(page);

    await setCell(page, 'A1', 'apple');
    await setCell(page, 'A2', 'banana');
    await setCell(page, 'A3', 'apple');

    await page.keyboard.press('Control+f');
    await expect(page.getByPlaceholder('Find…')).toBeVisible({ timeout: 5_000 });

    await page.getByPlaceholder('Find…').fill('xyz');

    await expect(page.locator('span').filter({ hasText: 'No matches' })).toBeVisible({ timeout: 8_000 });
  });

  test('Escape closes the dialog', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'find4');
    await openNewSheet(page);

    await page.keyboard.press('Control+f');
    await expect(page.getByPlaceholder('Find…')).toBeVisible({ timeout: 5_000 });

    // Press Escape while the find input is focused (dialog handles it)
    await page.getByPlaceholder('Find…').press('Escape');

    await expect(page.getByPlaceholder('Find…')).not.toBeVisible({ timeout: 5_000 });
  });
});

// ── Find and Replace dialog ───────────────────────────────────────────────────

test.describe('Find and Replace dialog', () => {
  test('opens with Ctrl+H showing replace input', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'replace1');
    await openNewSheet(page);

    await page.keyboard.press('Control+h');

    await expect(page.getByText('Find and Replace', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByPlaceholder('Replace with…')).toBeVisible({ timeout: 5_000 });
  });

  test('Replace all replaces every matching cell', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'replace2');
    await openNewSheet(page);

    await setCell(page, 'A1', 'old');
    await setCell(page, 'A2', 'old');
    await setCell(page, 'A3', 'keep');

    await page.keyboard.press('Control+h');
    await expect(page.getByPlaceholder('Find…')).toBeVisible({ timeout: 5_000 });

    await page.getByPlaceholder('Find…').fill('old');
    await page.getByPlaceholder('Replace with…').fill('new');

    await page.getByRole('button', { name: 'Replace all' }).click();

    await expectCell(page, 'A1', 'new');
    await expectCell(page, 'A2', 'new');
    await expectCell(page, 'A3', 'keep');

    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByPlaceholder('Find…')).not.toBeVisible({ timeout: 5_000 });
  });
});

// ── Column filter ─────────────────────────────────────────────────────────────

test.describe('Column filter', () => {
  test('filter dialog opens from column header context menu', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'filter1');
    await openNewSheet(page);

    await setCell(page, 'A1', 'Food');
    await setCell(page, 'A2', 'Transport');

    await rightClickColHeader(page, 'A');

    await expect(page.getByRole('menu', { name: 'Header options' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('menuitem', { name: 'Filter by values…' }).click();

    await expect(page.getByText('Filter column A', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('applying a filter hides rows with unselected values', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'filter2');
    await openNewSheet(page);

    await setCell(page, 'A1', 'Food');
    await setCell(page, 'A2', 'Transport');

    // Open the filter dialog via the column A header context menu
    await rightClickColHeader(page, 'A');
    await expect(page.getByRole('menu', { name: 'Header options' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('menuitem', { name: 'Filter by values…' }).click();
    await expect(page.getByText('Filter column A', { exact: true })).toBeVisible({ timeout: 5_000 });

    // Uncheck "Transport" so only "Food" remains selected
    await page.getByLabel('Transport').uncheck();

    await page.getByRole('button', { name: 'Apply' }).click();

    // A1 with "Food" should remain visible
    await expectCell(page, 'A1', 'Food');

    // A2's row is filtered out — the span inside A2 should not be visible
    await expect(page.locator('[data-type="cell"][id="A2"] span')).not.toBeVisible({ timeout: 5_000 });
  });
});
