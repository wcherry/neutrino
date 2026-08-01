/**
 * E2E coverage for the topbar search box (issue #73).
 *
 * Exercises the real product path: content is indexed by the client-side
 * search service on app start, the drop-down previews the hits, and Enter
 * hands the query to the Drive page as a dismissible filter.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

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
}

/**
 * Wait for ensureE2EKeys to store the keypair — the index sync only runs once
 * the user's E2EE keys are on the device.
 */
async function waitForKeypair(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i)?.startsWith('neutrino_e2e_')) return true;
      }
      return false;
    },
    { timeout: 15_000 },
  );
}

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

async function createNoteViaApi(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/notes`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title },
  });
  expect(res.ok(), `create note failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = (await res.json()) as { id: string };
  return data.id;
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

function searchBox(page: Page) {
  // Scoped to the topbar so the Drive page's own controls can never match.
  return page.locator('header').getByRole('searchbox', { name: 'Search' });
}

/**
 * Type `term` into the topbar box, retrying until the index catches up —
 * indexing happens in the background, and the drop-down only refreshes on
 * keystrokes.
 */
async function searchUntilResults(page: Page, term: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const box = searchBox(page);
        await box.fill('');
        await box.fill(term);
        return page.getByTestId('topbar-search-result').count();
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

    const result = page.getByTestId('topbar-search-result').first();
    await expect(result).toContainText(word);
    await expect(result).toContainText('Note');
    // "Mar 3, 2026" — the date of last change.
    await expect(result).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
    await expect(result.locator('svg')).toBeVisible();
  });

  test('says "No matches" instead of showing nothing', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);

    await searchBox(page).fill(`nothingmatchesthis${Date.now()}`);

    await expect(page.getByTestId('topbar-search-dropdown')).toBeVisible();
    await expect(page.getByTestId('topbar-search-empty')).toHaveText('No matches');
  });

  test('opens the item when a result is clicked', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);
    const token = await getAuthToken(page);

    const word = `quasarword${Date.now()}`;
    const noteId = await createNoteViaApi(request, token, `${word} agenda`);
    await reindexOnNextLoad(page);

    await searchUntilResults(page, word);
    await page.getByTestId('topbar-search-result').first().click();

    await expect(page).toHaveURL(new RegExp(`/notes/editor.*id=${noteId}`), { timeout: 15_000 });
  });

  test('Enter lists the hits on Drive behind a dismissible filter chip', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);
    const token = await getAuthToken(page);

    const word = `nebulaword${Date.now()}`;
    await createNoteViaApi(request, token, `${word} retrospective`);
    await reindexOnNextLoad(page);

    await searchUntilResults(page, word);
    await searchBox(page).press('Enter');

    await expect(page).toHaveURL(new RegExp(`/drive.*q=${word}`), { timeout: 15_000 });
    await expect(page.getByTestId('drive-search-chip')).toContainText(word);
    await expect(page.getByTestId('drive-search-result').first()).toContainText(word);
    // The box hands the term over to the chip and clears itself.
    await expect(searchBox(page)).toHaveValue('');

    await page.getByRole('button', { name: `Clear search filter ${word}` }).click();

    await expect(page.getByTestId('drive-search-chip')).toHaveCount(0);
    await expect(page.getByTestId('drive-search-result')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible();
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

    const result = page.getByTestId('topbar-search-result').first();
    await expect(result).toContainText(word);
    await expect(result).toContainText('File');
  });

  test('does not open the drop-down for queries below the minimum length', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);

    await searchBox(page).fill('ab');

    await expect(page.getByTestId('topbar-search-dropdown')).toHaveCount(0);
  });
});
