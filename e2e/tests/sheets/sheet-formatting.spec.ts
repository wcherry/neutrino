import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix = 'fmt'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page, prefix = 'fmt'): Promise<void> {
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

// ── Cell text formatting ──────────────────────────────────────────────────────

test.describe('Cell text formatting', () => {
  test('Strikethrough toolbar button toggles strikethrough style', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'fmt1');
    await openNewSheet(page);

    // Select A1
    await page.locator('[data-type="cell"][id="A1"]').click();

    const strikethroughBtn = page.getByTitle('Strikethrough');

    // Apply strikethrough
    await strikethroughBtn.click();
    await expect(strikethroughBtn).toHaveClass(/active/, { timeout: 5_000 });

    // Remove strikethrough
    await strikethroughBtn.click();
    await expect(strikethroughBtn).not.toHaveClass(/active/, { timeout: 5_000 });
  });

  test('Align Center toolbar button applies center alignment', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'fmt2');
    await openNewSheet(page);

    await page.locator('[data-type="cell"][id="A1"]').click();

    const alignCenterBtn = page.getByTitle('Align Center');
    const alignLeftBtn = page.getByTitle('Align Left');

    // Apply center alignment
    await alignCenterBtn.click();
    await expect(alignCenterBtn).toHaveClass(/active/, { timeout: 5_000 });

    // Switch to left alignment
    await alignLeftBtn.click();
    await expect(alignLeftBtn).toHaveClass(/active/, { timeout: 5_000 });
    await expect(alignCenterBtn).not.toHaveClass(/active/, { timeout: 5_000 });
  });

  test('Align Right toolbar button applies right alignment', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'fmt3');
    await openNewSheet(page);

    await page.locator('[data-type="cell"][id="A1"]').click();

    const alignRightBtn = page.getByTitle('Align Right');

    await alignRightBtn.click();
    await expect(alignRightBtn).toHaveClass(/active/, { timeout: 5_000 });
  });
});

// ── Undo and redo ─────────────────────────────────────────────────────────────

test.describe('Undo and redo', () => {
  test('Undo reverts a cell change', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'undo1');
    await openNewSheet(page);

    // Type "hello" in A1
    await setCell(page, 'A1', 'hello');
    await expectCell(page, 'A1', 'hello');

    // Type "world" over it
    await setCell(page, 'A1', 'world');
    await expectCell(page, 'A1', 'world');

    // Undo via toolbar button
    await page.getByTitle('Undo (⌘Z)').click();

    await expectCell(page, 'A1', 'hello');
  });

  test('Redo reapplies the reverted change', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'redo1');
    await openNewSheet(page);

    // Set up two committed values
    await setCell(page, 'A1', 'hello');
    await expectCell(page, 'A1', 'hello');

    await setCell(page, 'A1', 'world');
    await expectCell(page, 'A1', 'world');

    // Undo to revert to "hello"
    await page.getByTitle('Undo (⌘Z)').click();
    await expectCell(page, 'A1', 'hello');

    // Redo to restore "world"
    await page.getByTitle('Redo (⌘⇧Z)').click();
    await expectCell(page, 'A1', 'world');
  });
});
