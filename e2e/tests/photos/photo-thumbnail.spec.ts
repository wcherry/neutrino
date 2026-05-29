/**
 * Photo thumbnail generation tests.
 *
 * Verifies that when a photo is uploaded through the Photos UI, a thumbnail is
 * generated client-side (in the browser via the Canvas API) and saved to the
 * server as part of the same upload request. The Photos API should return a
 * non-null `thumbnail` field immediately after upload — no background job needed.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `e2e_photo_thumb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Photo Thumb User', email, password },
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

async function getUserId(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `profile fetch failed: ${res.status()}`).toBeTruthy();
  const profile = await res.json() as { id: string };
  return profile.id;
}

/**
 * Generate a browser-native JPEG by drawing to canvas in the page context.
 * This guarantees the bytes are decodable by the same Chromium instance that
 * will later load them in an <img> element during thumbnail generation.
 */
async function generateBrowserJpeg(page: Page, width = 10, height = 10): Promise<Buffer> {
  const bytes = await page.evaluate(
    ({ w, h }: { w: number; h: number }): number[] => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#4488CC';
      ctx.fillRect(0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const b64 = dataUrl.split(',')[1] ?? '';
      return Array.from(atob(b64), (c) => c.charCodeAt(0));
    },
    { w: width, h: height },
  );
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Photo thumbnail generation', () => {
  test('a photo uploaded via the Photos UI has a non-null thumbnail immediately after upload', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    // Wait for the E2EE keypair so the upload uses the encrypted path.
    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    await page.goto('/photos');
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 15_000 });

    // Generate a browser-native JPEG that Chromium can decode as an image element.
    const jpegBuffer = await generateBrowserJpeg(page);

    // Intercept the upload request to verify thumbnail_b64 is present in the FormData.
    let uploadHadThumbnail = false;
    await page.route('**/api/v1/drive/files/upload', async (route) => {
      const body = route.request().postDataBuffer();
      uploadHadThumbnail = body !== null && body.toString().includes('thumbnail_b64');
      await route.continue();
    });

    // Listen for the photo registration response before triggering the upload.
    const registerResPromise = page.waitForResponse(
      (r) => r.url().includes('/api/v1/photos') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Upload Photos', exact: true }).click(),
    ]);
    await fileChooser.setFiles([
      { name: 'test-photo.jpg', mimeType: 'image/jpeg', buffer: jpegBuffer },
    ]);

    const registerRes = await registerResPromise;
    expect(registerRes.ok(), `photo registration must succeed (got ${registerRes.status()})`).toBeTruthy();

    expect(
      uploadHadThumbnail,
      'upload request must include thumbnail_b64 — thumbnail should be generated client-side',
    ).toBe(true);

    // Fetch the photo list and verify the thumbnail was saved during upload.
    const listRes = await request.get(`${BASE_URL}/api/v1/photos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listRes.ok(), `listing photos must succeed: ${listRes.status()}`).toBeTruthy();

    const { photos } = await listRes.json() as {
      photos: { id: string; fileId: string; thumbnail: string | null }[];
    };
    expect(photos.length, 'at least one photo must exist after upload').toBeGreaterThan(0);

    expect(
      photos[0].thumbnail,
      'thumbnail must be non-null — it should be generated client-side and saved during upload',
    ).not.toBeNull();

    expect(
      (photos[0].thumbnail as string).length,
      'thumbnail must be non-empty base64',
    ).toBeGreaterThan(0);
  });
});
