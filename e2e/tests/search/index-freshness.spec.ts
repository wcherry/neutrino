import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `search_fresh_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Search Freshness Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
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

async function deleteNoteViaApi(
  request: APIRequestContext,
  token: string,
  noteId: string,
): Promise<void> {
  const res = await request.delete(`${BASE_URL}/api/v1/notes/${noteId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `delete note failed: ${res.status()}`).toBeTruthy();
}

/**
 * Wait for ensureE2EKeys to store the keypair. Required so that the search page
 * can initialize its IndexEngine (it only does so when a keypair exists).
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

/**
 * Go to Settings > Advanced tab and click "Rebuild index". Waits for the
 * success toast before returning so callers know indexing is complete.
 */
async function rebuildSearchIndex(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByRole('button', { name: 'Rebuild index' })).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Rebuild index' }).click();
  await expect(page.locator('[role="status"]')).toContainText('Search index rebuilt', {
    timeout: 30_000,
  });
}

test.describe('Search index freshness via Settings rebuild', () => {
  test('notes created before rebuild appear in search results', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);
    const token = await getAuthToken(page);

    const uniqueWord = `starburstword${Date.now()}`;
    await createNoteViaApi(request, token, `${uniqueWord} planning session`);

    await rebuildSearchIndex(page);

    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill(uniqueWord);
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('[data-testid="search-result"]').first()).toContainText('Note');
  });

  test('deleted note is absent from search after a subsequent rebuild', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);
    const token = await getAuthToken(page);

    const uniqueWord = `moonbeamword${Date.now()}`;
    const noteId = await createNoteViaApi(request, token, `${uniqueWord} review notes`);

    // First rebuild — note should be indexed and findable.
    await rebuildSearchIndex(page);
    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill(uniqueWord);
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(1, { timeout: 10_000 });

    // Delete the note, then rebuild — the full wipe + re-index removes stale entries.
    await deleteNoteViaApi(request, token, noteId);
    await rebuildSearchIndex(page);

    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill(uniqueWord);
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(/No results for/)).toBeVisible({ timeout: 5_000 });
  });

  test('rebuild on an account with no content completes successfully', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await waitForKeypair(page);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Advanced' }).click();
    await expect(page.getByRole('button', { name: 'Rebuild index' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Rebuild index' }).click();
    await expect(page.locator('[role="status"]')).toContainText('nothing to index', {
      timeout: 30_000,
    });
  });
});
