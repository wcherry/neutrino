import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix = 'autosave'): string {
  return `sheets_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
  prefix = 'autosave',
): Promise<void> {
  const email = uniqueEmail(prefix);
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Autosave Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

/**
 * Create a new spreadsheet and return its ID so we can reopen it later.
 * Waits until the cell grid is fully rendered.
 */
async function createSheetAndGetId(page: Page): Promise<string> {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Spreadsheet' }).click();
  await expect(page).toHaveURL(/\/sheets\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 15_000 });

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

test.describe('Sheets autosave — timed save', () => {
  test('a cell change is persisted after the 3-second autosave interval', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    await registerAndLogin(request, page, 'timed');
    const sheetId = await createSheetAndGetId(page);

    const cellValue = 'TimedSaveValue';
    await setCell(page, 'A1', cellValue);

    // Wait for the autosave request that driveAutosaveContent issues.
    // The endpoint is PUT /api/v1/drive/files/{id}/autosave
    const savedResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${sheetId}/autosave`) &&
        r.request().method() === 'PUT',
      { timeout: 15_000 },
    );

    // The timed save fires at most 3 seconds after the dirty flag is set.
    // Wait up to 8 seconds to be safe in a CI environment.
    await savedResponse;

    // Navigate away completely so the editor unmounts and React state is discarded
    await page.goto('/drive');
    await expect(page).toHaveURL(/\/drive/, { timeout: 10_000 });

    // Reopen the sheet
    await page.goto(`/sheets/editor?id=${sheetId}`);
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 20_000 });

    // The previously typed value must survive the round-trip
    await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText(cellValue, {
      timeout: 10_000,
    });
  });
});

test.describe('Sheets autosave — save on back-button navigation', () => {
  test('clicking the title-bar back arrow saves the sheet before navigating', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    await registerAndLogin(request, page, 'backbtn');
    const sheetId = await createSheetAndGetId(page);

    const cellValue = 'BackBtnSaveValue';
    await setCell(page, 'A1', cellValue);

    // The back button calls `await persist.save()` before router.push('/drive').
    // Intercept the autosave request so we can confirm it fired synchronously.
    const saveRequest = page.waitForRequest(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${sheetId}/autosave`) &&
        r.method() === 'PUT',
      { timeout: 10_000 },
    );

    // Click the "Sheets" back button (aria-label="Sheets")
    await page.getByRole('button', { name: 'Sheets' }).click();

    // The save must have been issued before or during the navigation
    await saveRequest;

    // We should land on /drive
    await expect(page).toHaveURL(/\/drive/, { timeout: 10_000 });

    // Reopen the sheet and verify persistence
    await page.goto(`/sheets/editor?id=${sheetId}`);
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText(cellValue, {
      timeout: 10_000,
    });
  });
});

test.describe('Sheets autosave — flush on SPA navigation (sidebar)', () => {
  test('navigating to Drive via the sidebar flushes and saves the sheet', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    await registerAndLogin(request, page, 'sidebar');
    const sheetId = await createSheetAndGetId(page);

    const cellValue = 'SidebarSaveValue';
    await setCell(page, 'A1', cellValue);

    // Intercept the flush-on-unmount save that usePersistence's cleanup fires.
    // This fires as a fire-and-forget call inside the effect cleanup.
    const saveRequest = page.waitForRequest(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${sheetId}/autosave`) &&
        r.method() === 'PUT',
      { timeout: 10_000 },
    );

    // Navigate to Drive via the sidebar "My Drive" link (SPA navigation that
    // unmounts the SheetEditor and triggers the flush-on-unmount effect).
    const sidebar = page.getByRole('navigation', { name: 'Primary navigation' });
    await sidebar.getByRole('link', { name: 'My Drive' }).click();

    // The flush must have fired
    await saveRequest;

    await expect(page).toHaveURL(/\/drive/, { timeout: 10_000 });

    // Reopen and verify
    await page.goto(`/sheets/editor?id=${sheetId}`);
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText(cellValue, {
      timeout: 10_000,
    });
  });
});
