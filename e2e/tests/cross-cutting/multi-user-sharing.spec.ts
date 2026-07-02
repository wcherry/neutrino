import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
  prefix = 'test',
): Promise<{ email: string; password: string }> {
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
  return { email, password };
}

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

async function getUserId(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `me fetch failed: ${res.status()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
}

/**
 * Upload a small text file to Drive via multipart API and return the file ID.
 */
async function uploadFile(
  request: APIRequestContext,
  token: string,
  filename: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: filename,
        mimeType: 'text/plain',
        buffer: Buffer.from(`Content of ${filename}`),
      },
    },
  });
  expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { id: string };
  return body.id;
}

/**
 * Create a share link for a file and return the share token.
 */
async function createShareLink(
  request: APIRequestContext,
  token: string,
  fileId: string,
): Promise<string> {
  const res = await request.put(
    `${BASE_URL}/api/v1/drive/files/${fileId}/share-link`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { visibility: 'anyoneWithLink', role: 'viewer' },
    },
  );
  expect(res.ok(), `share-link create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json() as { token: string };
  return body.token;
}

test.describe('Multi-user sharing', () => {
  test('share link allows a second browser context to view the shared item', async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(60_000);

    await registerAndLogin(request, page, 'share_owner');
    const token = await getAuthToken(page);
    const filename = `shared-file-${Date.now()}.txt`;
    const fileId = await uploadFile(request, token, filename);
    const shareToken = await createShareLink(request, token, fileId);

    const ctx2 = await browser.newContext();
    try {
      const page2 = await ctx2.newPage();
      await page2.goto(`${BASE_URL}/share?token=${shareToken}`);
      // The share page shows the resource name somewhere on the card
      await expect(page2.getByText(filename, { exact: false })).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx2.close();
    }
  });

  test('revoked share link shows error to second context', async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(60_000);

    await registerAndLogin(request, page, 'share_revoke');
    const token = await getAuthToken(page);
    const filename = `revoke-test-${Date.now()}.txt`;
    const fileId = await uploadFile(request, token, filename);
    const shareToken = await createShareLink(request, token, fileId);

    const ctx2 = await browser.newContext();
    try {
      const page2 = await ctx2.newPage();

      // Second context loads the share page and sees the file name
      await page2.goto(`${BASE_URL}/share?token=${shareToken}`);
      await expect(page2.getByText(filename, { exact: false })).toBeVisible({ timeout: 15_000 });

      // Owner revokes the share link
      const deleteRes = await request.delete(
        `${BASE_URL}/api/v1/drive/files/${fileId}/share-link`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(
        deleteRes.status() === 204 || deleteRes.status() === 200,
        `delete share-link failed: ${deleteRes.status()} ${await deleteRes.text()}`,
      ).toBeTruthy();

      // Second context reloads — should now see the not-found error
      await page2.reload();
      await expect(
        page2.getByText(/share link not found|not found/i),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx2.close();
    }
  });

  test('guest session token lets non-authenticated user open a shared doc', async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(60_000);

    await registerAndLogin(request, page, 'share_guest');
    const token = await getAuthToken(page);

    // Create a document via the drive FAB
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Document' }).click();
    await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });

    // Extract the doc file ID from the URL
    const urlMatch = page.url().match(/[?&]id=([^&]+)/);
    if (!urlMatch) throw new Error(`Could not extract doc ID from URL: ${page.url()}`);
    const docFileId = urlMatch[1];

    const shareToken = await createShareLink(request, token, docFileId);

    // Second context: unauthenticated user navigates to share page
    const ctx2 = await browser.newContext();
    try {
      const page2 = await ctx2.newPage();
      await page2.goto(`${BASE_URL}/share?token=${shareToken}`);

      // Click the "Open document" button — guest session sets access_token and redirects
      await page2.getByRole('button', { name: /open document/i }).click();

      // Should redirect to the doc editor
      await expect(page2).toHaveURL(/\/docs\/editor/, { timeout: 20_000 });
      await expect(page2.locator('.ProseMirror')).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx2.close();
    }
  });
});
