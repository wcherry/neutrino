import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `sheets_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Sheets Test User', email, password },
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

async function createSheetViaFAB(page: Page): Promise<void> {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Spreadsheet' }).click();
  await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Sheets' })).toBeVisible({ timeout: 10_000 });
  // Wait for the sheet title to load from the API before interacting with it,
  // so the title contentEditable reflects the server state and won't be reset
  // by the load() completing mid-edit.
  await expect(page.getByTestId('worksheet.name')).toContainText('Untitled spreadsheet', {
    timeout: 10_000,
  });
}

async function getSheetId(page: Page): Promise<string> {
  const match = page.url().match(/[?&]id=([^&]+)/);
  if (!match) throw new Error(`Could not extract sheet ID from URL: ${page.url()}`);
  return match[1];
}

/** Click a cell, type a value into the formula bar, commit with Enter. */
async function setCell(page: Page, ref: string, value: string): Promise<void> {
  await page.locator(`[data-type="cell"][id="${ref}"]`).click();
  const formulaInput = page.getByTestId('formula-bar-input');
  await formulaInput.fill(value);
  await formulaInput.press('Enter');
}

test.describe('Spreadsheets lifecycle', () => {
  // ── Create via FAB ───────────────────────────────────────────────────────────

  test('the FAB creates a new spreadsheet and navigates to the editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await expect(page.getByRole('menuitem', { name: 'Spreadsheet' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('menuitem', { name: 'Spreadsheet' }).click();
    await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Sheets' })).toBeVisible({ timeout: 10_000 });
  });

  // ── Full create → rename → back → list ──────────────────────────────────────

  test('creating a spreadsheet, renaming it, and going back shows the renamed spreadsheet in the list', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await createSheetViaFAB(page);

    // Change the spreadsheet name via the contentEditable title.
    // Triple-click selects all text reliably across platforms (Ctrl+A on macOS
    // moves the cursor to the line start instead of selecting all).
    const titleInput = page.getByTestId('worksheet.name');
    await titleInput.click({ clickCount: 3 });
    await page.keyboard.type('Q1 Budget');

    // Set up the response listener before triggering the blur, then blur to save.
    // A rename is a Drive file rename — spreadsheets have no endpoints of their
    // own beyond named ranges, AI and presence.
    const titleSaved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/drive/files/') && r.request().method() === 'PATCH',
      { timeout: 10_000 },
    );
    await titleInput.blur();
    await titleSaved;

    // Click the back button to return to Drive
    await page.getByRole('button', { name: 'Sheets' }).click();
    await expect(page).toHaveURL(/\/drive/, { timeout: 10_000 });

    // The renamed spreadsheet should appear in the drive file list. Drive lists
    // files under the name they are stored as, and a spreadsheet is a real
    // `.xlsx` since issue #127 — only the editor's own title bar drops the
    // extension.
    await expect(page.getByRole('listitem', { name: 'Q1 Budget.xlsx' })).toBeVisible({
      timeout: 10_000,
    });
  });

  // ── Add sheet tab → back → reopen ───────────────────────────────────────────

  test('a newly added sheet tab is still present after clicking back and reopening', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    await registerAndLogin(request, page);
    await createSheetViaFAB(page);

    const sheetId = await getSheetId(page);

    // Add a second sheet tab
    await page.getByRole('button', { name: '+', exact: true }).click();
    await expect(page.getByText('Sheet 2', { exact: true })).toBeVisible({ timeout: 5_000 });

    // The back button calls `await persist.save()` before navigating; wait for
    // the autosave PUT so we know the save completed before we reopen.
    const saveRequest = page.waitForRequest(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${sheetId}/autosave`) &&
        r.method() === 'PUT',
      { timeout: 10_000 },
    );

    await page.getByRole('button', { name: 'Sheets' }).click();
    await saveRequest;
    await expect(page).toHaveURL(/\/drive/, { timeout: 10_000 });

    // Reopen the same spreadsheet
    await page.goto(`/sheets/editor?id=${sheetId}`);
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 20_000 });

    // Both tabs must survive the round-trip
    await expect(page.getByText('Sheet 1', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Sheet 2', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  // ── Create a second spreadsheet from inside the first ───────────────────────

  test('the FAB opens a genuinely new spreadsheet while one is already open', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    await registerAndLogin(request, page);
    await createSheetViaFAB(page);
    const firstId = await getSheetId(page);

    // Content, so the first spreadsheet has autosaved and its `contentVersion`
    // has moved past the 1 a brand-new file starts at — which is the shape that
    // made issue #214 reproduce every time.
    await setCell(page, 'A1', 'first sheet');
    await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText('first sheet', {
      timeout: 10_000,
    });
    await page.waitForRequest(
      (r) => r.url().includes(`/api/v1/drive/files/${firstId}/autosave`) && r.method() === 'PUT',
      { timeout: 15_000 },
    );

    // The reported steps: New → Spreadsheet from inside an open spreadsheet.
    // Same route, different `?id=`, so nothing here is a fresh page load.
    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Spreadsheet' }).click();

    await expect
      .poll(async () => getSheetId(page), { timeout: 15_000 })
      .not.toBe(firstId);

    // What the user saw instead: a warning about the second spreadsheet having
    // changed elsewhere, raised by the first one's version guard.
    await expect(page.getByText(/changed elsewhere/i)).toHaveCount(0);

    // And the second spreadsheet is empty, rather than still showing — and one
    // save away from storing — the first one's content.
    await expect(page.getByTestId('worksheet.name')).toContainText('Untitled spreadsheet', {
      timeout: 15_000,
    });
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-type="cell"][id="A1"]')).not.toContainText('first sheet');
  });
});
