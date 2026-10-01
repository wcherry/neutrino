/**
 * A Drive file id is not a photo id.
 *
 * The web lists the Photos library from Drive, so that pictures which reached
 * Drive without a photo record (a phone's Drive backup) still show. Every
 * `/api/v1/photos/{id}` route wants the record's own id, though, so starring,
 * archiving or trashing an item by its file id answered 404 "Photo not found"
 * — for every photo on the All Photos tab, which is what filled the server log.
 *
 * Two server behaviours make the fix possible, and these pin them down:
 * `POST /photos/by-files` says which files have a record and what its id is,
 * and `POST /photos` is idempotent per file, so the web can register a
 * Drive-only picture the first time someone acts on it without ever creating a
 * second record for the same file.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `e2e_photo_ids_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<string> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Photo Ids User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);

  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

/** A picture uploaded straight into Drive — no photo record, as the Drive iOS backup leaves it. */
async function uploadDriveImage(request: APIRequestContext, token: string, name: string): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name, mimeType: 'image/jpeg', buffer: Buffer.from(`not really a jpeg: ${name}`) },
    },
  });
  expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

async function photosByFiles(request: APIRequestContext, token: string, fileIds: string[]) {
  const res = await request.post(`${BASE_URL}/api/v1/photos/by-files`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { fileIds },
  });
  expect(res.ok(), `by-files failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { photos: { id: string; fileId: string }[] }).photos;
}

async function registerPhoto(request: APIRequestContext, token: string, fileId: string) {
  const res = await request.post(`${BASE_URL}/api/v1/photos`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { fileId },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; fileId: string };
}

test.describe('Photos — file ids and photo ids', () => {
  test('a Drive-only picture has no record, and a file id is not a photo id', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const fileId = await uploadDriveImage(request, token, 'IMG_0001.jpg');

    expect(await photosByFiles(request, token, [fileId])).toEqual([]);

    // The request the web used to send for every item on All Photos.
    const star = await request.patch(`${BASE_URL}/api/v1/photos/${fileId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { isStarred: true },
    });
    expect(star.status()).toBe(404);
  });

  test('registering is idempotent per file, and the lookup finds the record', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const fileId = await uploadDriveImage(request, token, 'IMG_0002.jpg');
    const otherFileId = await uploadDriveImage(request, token, 'IMG_0003.jpg');

    const first = await registerPhoto(request, token, fileId);
    const second = await registerPhoto(request, token, fileId);
    expect(second.id).toBe(first.id);
    expect(first.id).not.toBe(fileId);

    const found = await photosByFiles(request, token, [fileId, otherFileId]);
    expect(found.map((p) => [p.id, p.fileId])).toEqual([[first.id, fileId]]);

    // And the record's id is the one the photo routes answer to.
    const star = await request.patch(`${BASE_URL}/api/v1/photos/${first.id}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { isStarred: true },
    });
    expect(star.ok(), `star failed: ${star.status()}`).toBeTruthy();
  });

  test('the lookup refuses more ids than a page needs', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const res = await request.post(`${BASE_URL}/api/v1/photos/by-files`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { fileIds: Array.from({ length: 501 }, (_, i) => `f${i}`) },
    });
    expect(res.status()).toBe(400);
  });
});
