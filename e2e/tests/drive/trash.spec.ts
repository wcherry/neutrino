import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `drive_trash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Trash Test User', email, password },
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

async function uploadFileViaApi(
  request: APIRequestContext,
  token: string,
  fileName: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: fileName,
        mimeType: 'text/plain',
        buffer: Buffer.from(`trash test content for ${fileName}`),
      },
    },
  });
  expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

async function createFolderViaApi(
  request: APIRequestContext,
  token: string,
  folderName: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/folders`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { name: folderName },
  });
  expect(res.ok(), `create folder failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

async function trashFileViaApi(
  request: APIRequestContext,
  token: string,
  fileId: string,
): Promise<void> {
  const res = await request.delete(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `trash file failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function trashFolderViaApi(
  request: APIRequestContext,
  token: string,
  folderId: string,
): Promise<void> {
  const res = await request.delete(`${BASE_URL}/api/v1/drive/folders/${folderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `trash folder failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe('Drive trash', () => {
  test('restoring a trashed file returns it to My Drive', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileName = uniqueName('restore-file') + '.txt';
    const fileId = await uploadFileViaApi(request, token, fileName);
    await trashFileViaApi(request, token, fileId);

    await page.goto('/drive/trash');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Trash');
    await expect(page.getByRole('listitem', { name: fileName })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('listitem', { name: fileName }).getByRole('button', { name: 'Restore' }).click();

    await expect(page.getByRole('listitem', { name: fileName })).not.toBeVisible({ timeout: 10_000 });

    await page.goto('/drive');
    const filesSection = page.locator('[aria-labelledby="all-files-heading"]');
    await expect(filesSection.getByRole('listitem', { name: fileName })).toBeVisible({ timeout: 10_000 });
  });

  test('restoring a trashed folder returns it to My Drive', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const folderName = uniqueName('restore-folder');
    const folderId = await createFolderViaApi(request, token, folderName);
    await trashFolderViaApi(request, token, folderId);

    await page.goto('/drive/trash');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Trash');
    await expect(page.getByRole('listitem', { name: folderName })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('listitem', { name: folderName }).getByRole('button', { name: 'Restore' }).click();

    await expect(page.getByRole('listitem', { name: folderName })).not.toBeVisible({ timeout: 10_000 });

    await page.goto('/drive');
    const filesSection = page.locator('[aria-labelledby="all-files-heading"]');
    await expect(filesSection.getByRole('listitem', { name: folderName })).toBeVisible({ timeout: 10_000 });
  });

  test('permanently deleting a file removes it from trash after confirmation', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileName = uniqueName('perm-delete-file') + '.txt';
    const fileId = await uploadFileViaApi(request, token, fileName);
    await trashFileViaApi(request, token, fileId);

    await page.goto('/drive/trash');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Trash');
    await expect(page.getByRole('listitem', { name: fileName })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('listitem', { name: fileName }).getByRole('button', { name: 'Delete forever' }).click();

    const modal = page.getByRole('dialog', { name: 'Delete permanently?' });
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await modal.getByRole('button', { name: 'Delete forever' }).click();

    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('listitem', { name: fileName })).not.toBeVisible({ timeout: 10_000 });
  });

  test('permanently deleting a folder removes it from trash after confirmation', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const folderName = uniqueName('perm-delete-folder');
    const folderId = await createFolderViaApi(request, token, folderName);
    await trashFolderViaApi(request, token, folderId);

    await page.goto('/drive/trash');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Trash');
    await expect(page.getByRole('listitem', { name: folderName })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('listitem', { name: folderName }).getByRole('button', { name: 'Delete forever' }).click();

    const modal = page.getByRole('dialog', { name: 'Delete permanently?' });
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await modal.getByRole('button', { name: 'Delete forever' }).click();

    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('listitem', { name: folderName })).not.toBeVisible({ timeout: 10_000 });
  });

  test('cancelling permanent delete keeps the item in trash', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileName = uniqueName('cancel-delete') + '.txt';
    const fileId = await uploadFileViaApi(request, token, fileName);
    await trashFileViaApi(request, token, fileId);

    await page.goto('/drive/trash');
    await expect(page.getByRole('listitem', { name: fileName })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('listitem', { name: fileName }).getByRole('button', { name: 'Delete forever' }).click();

    const modal = page.getByRole('dialog', { name: 'Delete permanently?' });
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await modal.getByRole('button', { name: 'Cancel' }).click();

    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('listitem', { name: fileName })).toBeVisible({ timeout: 5_000 });
  });

  test('empty trash page shows empty state message', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/drive/trash');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Trash');
    await expect(page.getByText('Trash is empty')).toBeVisible({ timeout: 10_000 });
  });
});
