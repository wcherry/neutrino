import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix = 'rowcol'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page, prefix = 'rowcol'): Promise<void> {
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
 * Right-click a data cell and wait for the cell context menu to appear.
 */
async function openCellContextMenu(page: Page, ref: string): Promise<void> {
  await page.locator(`[data-type="cell"][id="${ref}"]`).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Cell options' })).toBeVisible({ timeout: 5_000 });
}

/**
 * Right-click the column header for a given letter (e.g. "A") and wait for
 * the header context menu to appear.
 *
 * The SheetGrid renders column headers as absolutely-positioned divs above the
 * scrollable body.  There are no stable data-attributes, so we derive the click
 * coordinates from the first data cell in the target column:
 *   x = horizontal centre of the data cell
 *   y = 12px above the data cell top (landing in the 24px COL_HDR_H strip)
 */
async function openColHeaderContextMenu(page: Page, letter: string): Promise<void> {
  const firstCell = page.locator(`[data-type="cell"][id="${letter}1"]`);
  await firstCell.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await firstCell.boundingBox();
  if (!box) throw new Error(`Could not get bounding box for cell ${letter}1`);

  const x = box.x + box.width / 2;
  const y = box.y - 12; // 12px above cell top lands in the 24px column header strip

  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Header options' })).toBeVisible({ timeout: 5_000 });
}

// ── Insert and delete rows ────────────────────────────────────────────────────

test.describe('Insert and delete rows', () => {
  test('Insert row above shifts existing data down', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'row1');
    await openNewSheet(page);

    await setCell(page, 'A1', 'row1');
    await setCell(page, 'A2', 'row2');

    await openCellContextMenu(page, 'A1');
    await page.getByRole('menuitem', { name: 'Insert row above' }).click();

    // A new empty row was inserted above row 1; original data shifts down
    await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText('', { timeout: 8_000 });
    await expectCell(page, 'A2', 'row1');
    await expectCell(page, 'A3', 'row2');
  });

  test('Insert row below inserts without disturbing upper row', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'row2');
    await openNewSheet(page);

    await setCell(page, 'A1', 'row1');
    await setCell(page, 'A2', 'row2');

    await openCellContextMenu(page, 'A1');
    await page.getByRole('menuitem', { name: 'Insert row below' }).click();

    // A1 keeps its value; a new empty row is inserted at 2; original A2 moves to A3
    await expectCell(page, 'A1', 'row1');
    await expect(page.locator('[data-type="cell"][id="A2"] span')).toHaveText('', { timeout: 8_000 });
    await expectCell(page, 'A3', 'row2');
  });

  test('Delete row removes the row and shifts data up', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'row3');
    await openNewSheet(page);

    await setCell(page, 'A1', 'keep');
    await setCell(page, 'A2', 'remove');
    await setCell(page, 'A3', 'keep2');

    await openCellContextMenu(page, 'A2');
    await page.getByRole('menuitem', { name: 'Delete row' }).click();

    await expectCell(page, 'A1', 'keep');
    await expectCell(page, 'A2', 'keep2');
  });
});

// ── Insert and delete columns ─────────────────────────────────────────────────

test.describe('Insert and delete columns', () => {
  test('Insert column left shifts existing data right', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'col1');
    await openNewSheet(page);

    await setCell(page, 'A1', 'col1');
    await setCell(page, 'B1', 'col2');

    await openCellContextMenu(page, 'A1');
    await page.getByRole('menuitem', { name: 'Insert column left' }).click();

    // A new empty column is inserted at A; original columns shift right
    await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText('', { timeout: 8_000 });
    await expectCell(page, 'B1', 'col1');
    await expectCell(page, 'C1', 'col2');
  });

  test('Delete column removes and shifts remaining data left', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'col2');
    await openNewSheet(page);

    await setCell(page, 'A1', 'keep');
    await setCell(page, 'B1', 'remove');
    await setCell(page, 'C1', 'keep2');

    await openCellContextMenu(page, 'B1');
    await page.getByRole('menuitem', { name: 'Delete column' }).click();

    await expectCell(page, 'A1', 'keep');
    await expectCell(page, 'B1', 'keep2');
  });
});

// ── Clear cells ───────────────────────────────────────────────────────────────

test.describe('Clear cells', () => {
  test('Clear cell(s) empties selected cells', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'clear1');
    await openNewSheet(page);

    await setCell(page, 'A1', 'data');
    await expectCell(page, 'A1', 'data');

    await openCellContextMenu(page, 'A1');
    await page.getByRole('menuitem', { name: 'Clear cell(s)' }).click();

    await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText('', { timeout: 8_000 });
  });
});

// ── Sort column from header context menu ──────────────────────────────────────

test.describe('Sort column from header context menu', () => {
  test('Sort A → Z sorts column values ascending', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'sort1');
    await openNewSheet(page);

    await setCell(page, 'A1', 'banana');
    await setCell(page, 'A2', 'apple');
    await setCell(page, 'A3', 'cherry');

    await openColHeaderContextMenu(page, 'A');
    await page.getByRole('menuitem', { name: 'Sort A → Z' }).click();

    await expectCell(page, 'A1', 'apple');
    await expectCell(page, 'A2', 'banana');
    await expectCell(page, 'A3', 'cherry');
  });

  test('Sort Z → A sorts column values descending', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'sort2');
    await openNewSheet(page);

    await setCell(page, 'A1', 'apple');
    await setCell(page, 'A2', 'banana');
    await setCell(page, 'A3', 'cherry');

    await openColHeaderContextMenu(page, 'A');
    await page.getByRole('menuitem', { name: 'Sort Z → A' }).click();

    await expectCell(page, 'A1', 'cherry');
    await expectCell(page, 'A2', 'banana');
    await expectCell(page, 'A3', 'apple');
  });
});
