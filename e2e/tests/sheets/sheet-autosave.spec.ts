import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page, Request } from '@playwright/test';

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

    // Set up the response listener BEFORE editing the cell. The 3-second
    // autosave timer may fire during setCell (after dirtyRef is set) and its
    // response can arrive before waitForResponse is registered, causing a miss.
    // Registering first ensures we capture any save — timer-fired or
    // flush-on-unmount — regardless of timing.
    const saveResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${sheetId}/autosave`) &&
        r.request().method() === 'PUT',
      { timeout: 15_000 },
    );

    await setCell(page, 'A1', cellValue);

    // Navigate to Drive via the sidebar "My Drive" link (SPA navigation that
    // unmounts the SheetEditor and triggers the flush-on-unmount effect).
    const sidebar = page.getByRole('navigation', { name: 'Primary navigation' });
    await sidebar.getByRole('link', { name: 'My Drive' }).click();

    // The save must have been acknowledged by the server.
    await saveResponse;

    await expect(page).toHaveURL(/\/drive/, { timeout: 10_000 });

    // Reopen and verify
    await page.goto(`/sheets/editor?id=${sheetId}`);
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('[data-type="cell"][id="A1"] span')).toHaveText(cellValue, {
      timeout: 10_000,
    });
  });
});

test.describe('Sheets autosave — no spurious save on load', () => {
  test('reopening an existing sheet does not trigger an autosave without user edits', async ({
    page,
    request,
  }) => {
    // The autosave timer fires every 3 seconds, so we observe for 4.5 s after the
    // grid is visible — long enough to catch both an immediate spurious save and a
    // timer-tick save.
    test.setTimeout(75_000);

    await registerAndLogin(request, page, 'nosave');
    const sheetId = await createSheetAndGetId(page);

    // Write data so the sheet is non-empty when we reopen it.
    await setCell(page, 'A1', 'StableValue');

    // Wait for the autosave that follows the edit.
    await page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${sheetId}/autosave`) &&
        r.request().method() === 'PUT',
      { timeout: 15_000 },
    );

    // Navigate away so the editor unmounts completely.
    await page.goto('/drive');
    await expect(page).toHaveURL(/\/drive/, { timeout: 10_000 });

    // Track any autosave requests that fire after reopening (before any edit).
    let spuriousSaveCount = 0;
    const trackSave = (req: Request) => {
      if (
        req.url().includes(`/api/v1/drive/files/${sheetId}/autosave`) &&
        req.method() === 'PUT'
      ) {
        spuriousSaveCount++;
      }
    };
    page.on('request', trackSave);

    // Reopen the sheet and wait for the grid to be fully rendered.
    await page.goto(`/sheets/editor?id=${sheetId}`);
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 20_000 });

    // Observe for longer than the 3-second autosave interval without interacting.
    await page.waitForTimeout(4_500);
    page.off('request', trackSave);

    expect(
      spuriousSaveCount,
      'autosave must not fire when reopening a sheet with no pending changes',
    ).toBe(0);
  });

  test('reopening an encrypted sheet does not trigger an autosave without user edits', async ({
    page,
    request,
  }) => {
    // Same as the non-encrypted test but with E2EE active; the old bug fired
    // save() unconditionally at the end of load() whenever dekRef was set.
    test.setTimeout(90_000);

    await registerAndLogin(request, page, 'nosave_enc');

    // Resolve the user ID via the profile endpoint so we can wait for the E2EE
    // keypair (stored under `neutrino_e2e_<userId>` in localStorage).
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    if (!token) throw new Error('access_token not found in localStorage');
    const profileRes = await request.get(`${BASE_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(profileRes.ok(), `profile fetch failed: ${profileRes.status()}`).toBeTruthy();
    const { id: userId } = await profileRes.json() as { id: string };

    // Wait for the browser to generate and store the E2EE keypair.
    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 15_000 },
    );

    const sheetId = await createSheetAndGetId(page);

    // Write data and wait for the initial autosave.
    await setCell(page, 'A1', 'EncStable');
    await page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${sheetId}/autosave`) &&
        r.request().method() === 'PUT',
      { timeout: 15_000 },
    );

    // Navigate away.
    await page.goto('/drive');
    await expect(page).toHaveURL(/\/drive/, { timeout: 10_000 });

    let spuriousSaveCount = 0;
    const trackSave = (req: Request) => {
      if (
        req.url().includes(`/api/v1/drive/files/${sheetId}/autosave`) &&
        req.method() === 'PUT'
      ) {
        spuriousSaveCount++;
      }
    };
    page.on('request', trackSave);

    // Reopen the encrypted sheet.
    await page.goto(`/sheets/editor?id=${sheetId}`);
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 20_000 });

    // Observe past the autosave interval.
    await page.waitForTimeout(4_500);
    page.off('request', trackSave);

    expect(
      spuriousSaveCount,
      'autosave must not fire when reopening an encrypted sheet with no pending changes',
    ).toBe(0);
  });
});
