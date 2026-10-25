/**
 * E2E coverage for searching from the top bar (issue #73).
 *
 * Search is an icon in every look that opens the command palette, which lists
 * file hits above commands. Exercises the real product path: content is indexed
 * by the client-side search service on app start, the palette previews the hits,
 * and Enter on a query with nothing to open hands it to the Drive page as a
 * dismissible filter.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption, hasAnyKeyring } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';
import { createNoteViaApi } from '../../fixtures/notes';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `topbar_search_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Topbar Search User', email, password },
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

/**
 * Wait for the keyring to reach this device's key store — the index sync only
 * runs once the user's E2EE keys are on the device.
 */
async function waitForKeypair(page: Page): Promise<void> {
  await expect.poll(() => hasAnyKeyring(page), { timeout: 15_000 }).toBe(true);
}

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

async function uploadFileViaApi(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name, mimeType: 'text/plain', buffer: Buffer.from('search fixture') },
    },
  });
  expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/**
 * Force the background index sync to run again on the next load. The sync is
 * throttled by a localStorage timestamp, which would otherwise make content
 * created mid-session invisible for the length of the throttle window.
 */
async function reindexOnNextLoad(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('neutrino:search:lastSync:')) localStorage.removeItem(key);
    }
  });
  await page.reload();
}

function palette(page: Page) {
  return page.getByRole('dialog', { name: 'Search and commands' });
}

/** Opens the palette from the top bar's search icon and returns its query field. */
async function searchBox(page: Page) {
  if (!(await palette(page).isVisible())) {
    await page.getByRole('button', { name: 'Search and commands' }).click();
  }
  return palette(page).getByRole('combobox');
}

/** The palette's file hits for `term` (its commands never contain these made-up words). */
function hits(page: Page, term: string) {
  return palette(page).getByRole('option').filter({ hasText: term });
}

/**
 * Type `term` into the palette, retrying until the index catches up —
 * indexing happens in the background, and the hits only refresh on
 * keystrokes.
 */
async function searchUntilResults(page: Page, term: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const box = await searchBox(page);
        await box.fill('');
        await box.fill(term);
        return hits(page, term).count();
      },
      { timeout: 45_000, message: `no search results for "${term}"` },
    )
    .toBeGreaterThan(0);
}

test.describe('Topbar search', () => {
  test('shows matching items with an icon and last-changed date', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);
    const token = await getAuthToken(page);

    const word = `zephyrword${Date.now()}`;
    await createNoteViaApi(request, token, `${word} planning session`);
    await reindexOnNextLoad(page);

    await searchUntilResults(page, word);

    const result = hits(page, word).first();
    await expect(result).toContainText(word);
    await expect(result).toContainText('Note');
    // "Mar 3, 2026" — the date of last change.
    await expect(result).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
    await expect(result.locator('svg')).toBeVisible();
  });

  test('says "No matches" instead of showing nothing', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);

    await (await searchBox(page)).fill(`nothingmatchesthis${Date.now()}`);

    await expect(palette(page).getByText('No matching files')).toBeVisible();
  });

  test('opens the item when a result is clicked', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);
    const token = await getAuthToken(page);

    const word = `quasarword${Date.now()}`;
    const noteId = await createNoteViaApi(request, token, `${word} agenda`);
    await reindexOnNextLoad(page);

    await searchUntilResults(page, word);
    await hits(page, word).first().click();

    await expect(page).toHaveURL(new RegExp(`/notes/editor.*id=${noteId}`), { timeout: 15_000 });
  });

  test('Drive lists the hits behind a dismissible filter chip', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);
    const token = await getAuthToken(page);

    const word = `nebulaword${Date.now()}`;
    await createNoteViaApi(request, token, `${word} retrospective`);
    await reindexOnNextLoad(page);
    await searchUntilResults(page, word);
    await page.keyboard.press('Escape');

    // The full list the palette's hits are a preview of.
    await page.goto(`/drive?q=${word}`);
    await expect(page.getByTestId('drive-search-chip')).toContainText(word);
    await expect(page.getByRole('heading', { name: 'Search results' })).toBeVisible();
    // Hits render as ordinary Drive grid items.
    await expect(page.getByRole('listitem').filter({ hasText: word }).first()).toBeVisible();

    await page.getByRole('button', { name: `Clear search filter ${word}` }).click();

    await expect(page.getByTestId('drive-search-chip')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
  });

  test('Enter on a query with nothing to open goes to the Drive search view', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);

    const word = `voidword${Date.now()}`;
    await (await searchBox(page)).fill(word);
    await expect(palette(page).getByText('No matching files')).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/drive.*q=${word}`), { timeout: 15_000 });
    await expect(page.getByTestId('drive-search-chip')).toContainText(word);
    await expect(page.locator('main').getByText('No matches')).toBeVisible({ timeout: 15_000 });
  });

  test('Drive search view reports when nothing matched', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);

    const word = `voidword${Date.now()}`;
    await page.goto(`/drive?q=${word}`);

    await expect(page.getByTestId('drive-search-chip')).toContainText(word);
    await expect(page.locator('main').getByText('No matches')).toBeVisible({ timeout: 15_000 });
  });

  test('finds an uploaded Drive file by name', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);
    const token = await getAuthToken(page);

    const word = `pulsarword${Date.now()}`;
    await uploadFileViaApi(request, token, `${word}.txt`);
    await reindexOnNextLoad(page);

    await searchUntilResults(page, word);

    const result = hits(page, word).first();
    await expect(result).toContainText(word);
    await expect(result).toContainText('File');
  });

  test('does not search files for queries below the minimum length', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);

    await (await searchBox(page)).fill('ab');

    await expect(palette(page).getByText('No matching files')).toHaveCount(0);
    await expect(palette(page).getByRole('presentation').filter({ hasText: /^Files/ })).toHaveCount(0);
  });
});
