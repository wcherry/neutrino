/**
 * E2EE encryption tests.
 *
 * Validates two properties:
 *   1. Setting up encryption stores a Curve25519 keyring in this device's key
 *      store, sealed, with a secretKey distinct from the published publicKey.
 *   2. Files uploaded via the UI are encrypted: the server holds an opaque
 *      encrypted DEK for the file, and the raw stored bytes are not the
 *      original plaintext.
 */

import { test, expect } from '../../fixtures/base';
import {
  setUpEncryption,
  waitForKeyring,
  readKeystoreRecord,
  activeKeyPair,
} from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  initSodium,
  decryptFile,
  decryptFileKey,
} from '../../../web/packages/e2e-crypto/src/crypto';

const BASE_URL = 'http://localhost:9880';

// Host-side path to the storage directory.
// Matches the docker-compose mount: ${RUN_DIR}/data:/usr/local/data + STORAGE_PATH=/usr/local/data/storage
const runDir = process.env.RUN_DIR ?? '/tmp/neutrino-e2e/default';
const STORAGE_PATH = process.env.DRIVE_STORAGE_PATH ?? path.join(runDir, 'data/storage');



// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueEmail(): string {
  return `e2e_enc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function uniqueFilename(): string {
  return `enc-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.txt`;
}

/**
 * One stored blob, by the key `store.rs` writes it under.
 *
 * A file is a directory of versions — `{STORAGE_PATH}/{user_id}/{file_id}/{version_id}`
 * — holding the current content *and* the older snapshots alike, with the
 * file's `storage_path` naming whichever is live (issue #167). Before that the
 * content lived at `{user_id}/{file_id}` with history under
 * `{user_id}/versions/{file_id}/{version_id}`, and every upload wrote its bytes
 * out twice.
 */
function readStoredVersion(userId: string, fileId: string, versionId: string): Buffer {
    return fs.readFileSync(path.join(STORAGE_PATH, userId, fileId, versionId));
}

/** Every version id the file's directory on disk holds bytes for. */
function storedVersionIds(userId: string, fileId: string): string[] {
    return fs.readdirSync(path.join(STORAGE_PATH, userId, fileId));
}

function fromBase64url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<{ email: string; password: string }> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'E2E Enc User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);

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
  expect(res.ok(), `profile fetch failed: ${res.status()}`).toBeTruthy();
  const profile = await res.json() as { id: string };
  return profile.id;
}

/** Upload a file via the Drive UI upload dialog. */
async function uploadFileViaUI(
  page: Page,
  fileName: string,
  content: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Upload' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const dropZone = dialog.getByRole('button', { name: 'Drag & drop files here' });
  const dataTransfer = await page.evaluateHandle(
    ({ name, content }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], name, { type: 'text/plain' }));
      return dt;
    },
    { name: fileName, content },
  );
  await dropZone.dispatchEvent('drop', { dataTransfer });

  await expect(dialog.locator('[role="progressbar"]')).toHaveAttribute(
    'aria-valuenow',
    '100',
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
}

/** Return the ID of the most-recently uploaded file with the given name. */
async function findFileId(
  request: APIRequestContext,
  token: string,
  fileName: string,
): Promise<string> {
  const res = await request.get(`${BASE_URL}/api/v1/drive/files`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `file list failed: ${res.status()}`).toBeTruthy();
  const data = await res.json() as { files: { id: string; name: string }[] };
  const file = data.files.find((f) => f.name === fileName);
  if (!file) throw new Error(`File "${fileName}" not found in drive file list`);
  return file.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('E2EE key lifecycle and file encryption', () => {
  // ── 1. Keyring stored on the device ───────────────────────────────────────

  test('setting up encryption writes a keyring to this device’s key store', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    await waitForKeyring(page, userId);

    const record = await readKeystoreRecord(page, userId);
    expect(record, 'a keystore record must exist for the signed-in user').not.toBeNull();
    expect(record!.userId, 'the record must be keyed by user id').toBe(userId);
    expect(
      record!.method,
      'a keyring created in the browser is device-wrapped',
    ).toBe('device');

    // What reaches disk is a sealed blob, never the serialised keyring: a
    // record whose secret keys could be read straight out of it would defeat
    // the point of wrapping it at all.
    expect(typeof record!.blob, 'the stored keyring must be a sealed blob').toBe('string');
    expect(record!.blob.length, 'the sealed blob must be non-empty').toBeGreaterThan(0);
    expect(record!.blob, 'the stored blob must not be readable JSON').not.toContain('"entries"');
  });

  test('the stored keyring holds a secretKey distinct from its published publicKey', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    await waitForKeyring(page, userId);
    const { publicKey, secretKey } = await activeKeyPair(page, userId);

    // Both keys are base64url of 32 bytes — ceil(32 * 4/3) = 43 characters
    // without padding.
    expect(publicKey.length, 'publicKey should be 43 chars (32-byte Curve25519)').toBe(43);
    expect(secretKey.length, 'secretKey should be 43 chars (32-byte Curve25519)').toBe(43);
    expect(secretKey, 'secretKey must differ from publicKey').not.toBe(publicKey);

    // The public half must reach the server's directory, or nothing can seal a
    // DEK to this user — including their own editors, on their first save.
    const keyRes = await request.get(`${BASE_URL}/api/v1/auth/users/${userId}/public-key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `the active public key must be published (got ${keyRes.status()})`,
    ).toBeTruthy();
    const published = await keyRes.json() as { publicKey: string };
    expect(
      published.publicKey,
      'the published key must be the active half of the stored keyring',
    ).toBe(publicKey);
  });

  // ── 2. Uploaded files are encrypted ───────────────────────────────────────

  test('uploading a file via UI stores an encrypted DEK on the server', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    // Wait for the keypair to be ready so the upload uses the E2EE path.
    await waitForKeyring(page, userId);

    await page.goto('/drive');
    const fileName = uniqueFilename();
    const plaintext = `neutrino e2e secret content ${Date.now()}`;
    await uploadFileViaUI(page, fileName, plaintext);

    const fileId = await findFileId(request, token, fileName);

    // The server must have a key ref for this file.
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `expected encrypted DEK on server but got ${keyRes.status()}`,
    ).toBeTruthy();

    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(
      typeof keyData.encryptedFileKey,
      'encryptedFileKey must be a string',
    ).toBe('string');
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);
  });

  test('raw bytes stored on the server are not the original plaintext', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    await waitForKeyring(page, userId);

    await page.goto('/drive');
    const fileName = uniqueFilename();
    const plaintext = `top secret ${Date.now()} do not expose`;
    await uploadFileViaUI(page, fileName, plaintext);

    const fileId = await findFileId(request, token, fileName);

    // Download the raw blob the server stored.
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok(), `download failed: ${downloadRes.status()}`).toBeTruthy();

    const rawBody = await downloadRes.body();
    const rawText = rawBody.toString('utf8');

    // The server-stored blob must not contain the original plaintext string.
    expect(rawText, 'server must not store plaintext').not.toContain('top secret');
    expect(rawText, 'server must not store plaintext').not.toContain('do not expose');

    // The raw bytes should also be longer than the plaintext due to AEAD
    // overhead (24-byte header + 17-byte Poly1305 tag).
    expect(
      rawBody.length,
      'ciphertext must be larger than plaintext due to encryption overhead',
    ).toBeGreaterThan(Buffer.byteLength(plaintext, 'utf8'));
  });

  // ── 3. Downloaded file is decrypted ───────────────────────────────────────

  test('downloading an encrypted file via the UI yields the original plaintext', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    // Wait for keypair so the upload uses the E2EE path.
    await waitForKeyring(page, userId);

    await page.goto('/drive');
    const fileName = uniqueFilename();
    const plaintext = `decryption e2e test ${Date.now()} secret payload`;
    await uploadFileViaUI(page, fileName, plaintext);

    // Wait for the file card to appear in the grid.
    await expect(page.getByText(fileName)).toBeVisible({ timeout: 10_000 });

    // Open the context menu for the file.
    await page.getByRole('button', { name: `More options for ${fileName}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Download' })).toBeVisible({ timeout: 5_000 });

    // Intercept the download triggered by handleDownload.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download' }).click();
    const download = await downloadPromise;

    // Read the downloaded file content.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const downloadedText = Buffer.concat(chunks).toString('utf8');

    expect(downloadedText, 'downloaded content must match original plaintext').toBe(plaintext);
  });

  // ── 4. The file's stored version is ciphertext on disk, and end-to-end ─────

  test('the auto-created version holding a file’s bytes is stored as ciphertext on disk and is E2EE', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    await waitForKeyring(page, userId);

    await page.goto('/drive');
    const fileName = uniqueFilename();
    const plaintext = `disk-and-e2e encryption test ${Date.now()} secret payload`;
    await uploadFileViaUI(page, fileName, plaintext);

    const fileId = await findFileId(request, token, fileName);

    // Download the bytes the server serves — this is the E2EE ciphertext.
    const apiRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(apiRes.ok(), `download failed: ${apiRes.status()}`).toBeTruthy();
    const serverBytes = await apiRes.body();

    // ── Disk: version 1, which is the file ───────────────────────────────────
    // Version 1 is created by finalize_upload out of the staged bytes. Since
    // issue #167 it *is* the current content rather than a second copy of it,
    // so the file's directory holds exactly one blob after an upload.
    const versionsRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/versions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(versionsRes.ok()).toBeTruthy();
    const { versions } = await versionsRes.json() as {
      versions: { id: string; versionNumber: number }[];
    };
    expect(
      versions.length,
      'version 1 snapshot must be created automatically on upload',
    ).toBeGreaterThan(0);

    const v1 = [...versions].sort((a, b) => a.versionNumber - b.versionNumber)[0];
    expect(
      storedVersionIds(userId, fileId).sort(),
      'the file directory must hold one blob per version row and nothing else',
    ).toEqual([...versions.map((v) => v.id)].sort());

    const diskFileBytes = readStoredVersion(userId, fileId, v1.id);

    expect(
      diskFileBytes.toString('utf8'),
      'the file on disk must not contain plaintext',
    ).not.toContain(plaintext.slice(0, 20));
    // Server stores the E2EE ciphertext as-is — disk bytes must equal what the API serves.
    expect(
      diskFileBytes.equals(serverBytes),
      'disk bytes must match the E2EE ciphertext served by the API',
    ).toBe(true);

    // ── E2EE round-trip: client can decrypt server bytes back to plaintext ───
    const storedKeyPair = await activeKeyPair(page, userId);
    await initSodium();

    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(keyRes.ok(), `file key fetch failed: ${keyRes.status()}`).toBeTruthy();
    const { encryptedFileKey } = await keyRes.json() as { encryptedFileKey: string };

    const dek = decryptFileKey(
      encryptedFileKey,
      fromBase64url(storedKeyPair.publicKey),
      fromBase64url(storedKeyPair.secretKey),
    );

    const cipherBytes = new Uint8Array(serverBytes);
    const decrypted = new TextDecoder().decode(decryptFile(cipherBytes, dek));

    expect(
      decrypted,
      'client must decrypt server bytes back to the original plaintext',
    ).toBe(plaintext);
  });

  test('encrypted DEK cannot be read by a different user', async ({ page, request }) => {
    test.setTimeout(60_000);
    // Register owner and upload an encrypted file.
    await registerAndLogin(request, page);
    const ownerToken = await getAuthToken(page);
    const ownerId = await getUserId(request, ownerToken);

    await waitForKeyring(page, ownerId);

    await page.goto('/drive');
    const fileName = uniqueFilename();
    await uploadFileViaUI(page, fileName, 'owner only content');
    const fileId = await findFileId(request, ownerToken, fileName);

    // Register a second user.
    const otherEmail = uniqueEmail();
    const regRes = await request.post(`${BASE_URL}/api/v1/auth/register`, {
      data: { name: 'Other User', email: otherEmail, password: 'Password123!' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(regRes.ok()).toBeTruthy();
    const loginRes = await request.post(`${BASE_URL}/api/v1/auth/login`, {
      data: { email: otherEmail, password: 'Password123!' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { accessToken: otherToken } = await loginRes.json() as { accessToken: string };

    // The other user must not be able to fetch the owner's file key.
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/key`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    // Expect 403 (forbidden) or 404 (not found) — not 200.
    expect(
      [403, 404],
      `other user must not see the encrypted DEK, got ${keyRes.status()}`,
    ).toContain(keyRes.status());
  });
});

// ---------------------------------------------------------------------------
// E2EE for sheets, docs, slides, and photos
// ---------------------------------------------------------------------------

test.describe('E2EE for sheets, docs, slides, and photos', () => {
  // ── Shared helpers ─────────────────────────────────────────────────────────

  async function loginUser(
    request: APIRequestContext,
    page: Page,
  ): Promise<{ token: string; userId: string }> {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);
    await waitForKeyring(page, userId);
    return { token, userId };
  }

  // ── Sheets ─────────────────────────────────────────────────────────────────

  test('creating a sheet stores an encrypted DEK and encrypted content on the server', async ({
    page,
    request,
  }) => {
    const { token } = await loginUser(request, page);

    await page.goto('/drive');

    // Register the autosave listener before clicking so we don't miss the first save.
    const autosavePromise = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/drive/files/') &&
        !r.url().endsWith('/key') &&
        ['POST', 'PUT'].includes(r.request().method()),
      { timeout: 30_000 },
    );

    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Spreadsheet' }).click();

    // Wait until the editor page loads (URL changes to /sheets/editor)
    await expect(page).toHaveURL(/\/sheets\/editor/, { timeout: 30_000 });

    // Extract the sheet ID from the URL
    const url = page.url();
    const sheetId = new URL(url).searchParams.get('id');
    expect(sheetId, 'sheet ID must be present in editor URL').toBeTruthy();

    // Wait for the initial autosave — DEK is stored before the first autosave runs.
    await autosavePromise;

    // Verify an encrypted DEK is stored for the sheet
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${sheetId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `expected encrypted DEK for sheet but got ${keyRes.status()}`,
    ).toBeTruthy();
    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);

    // Verify the stored content is not the plaintext initial JSON
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${sheetId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok()).toBeTruthy();
    const rawText = (await downloadRes.body()).toString('utf8');
    expect(rawText, 'server must not store plaintext sheet JSON').not.toContain('"celldata"');
    expect(rawText, 'server must not store plaintext sheet JSON').not.toContain('"Sheet1"');
  });

  // ── Docs ───────────────────────────────────────────────────────────────────

  test('creating a doc stores an encrypted DEK and encrypted content on the server', async ({
    page,
    request,
  }) => {
    const { token } = await loginUser(request, page);

    await page.goto('/drive');

    const autosavePromiseDoc = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/drive/files/') &&
        !r.url().endsWith('/key') &&
        ['POST', 'PUT'].includes(r.request().method()),
      { timeout: 30_000 },
    );

    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Document' }).click();

    await expect(page).toHaveURL(/\/docs\/editor/, { timeout: 30_000 });

    const url = page.url();
    const docId = new URL(url).searchParams.get('id');
    expect(docId, 'doc ID must be present in editor URL').toBeTruthy();

    await autosavePromiseDoc;

    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${docId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `expected encrypted DEK for doc but got ${keyRes.status()}`,
    ).toBeTruthy();
    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);

    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${docId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok()).toBeTruthy();
    const rawText = (await downloadRes.body()).toString('utf8');
    expect(rawText, 'server must not store plaintext doc JSON').not.toContain('"type":"doc"');
    expect(rawText, 'server must not store plaintext doc JSON').not.toContain('"content":[]');
  });

  // ── Slides ─────────────────────────────────────────────────────────────────

  test('creating a slide stores an encrypted DEK and encrypted content on the server', async ({
    page,
    request,
  }) => {
    const { token } = await loginUser(request, page);

    await page.goto('/drive');

    const autosavePromiseSlide = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/drive/files/') &&
        !r.url().endsWith('/key') &&
        ['POST', 'PUT'].includes(r.request().method()),
      { timeout: 30_000 },
    );

    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Presentation' }).click();

    await expect(page).toHaveURL(/\/slides\/editor/, { timeout: 30_000 });

    const url = page.url();
    const slideId = new URL(url).searchParams.get('id');
    expect(slideId, 'slide ID must be present in editor URL').toBeTruthy();

    await autosavePromiseSlide;

    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${slideId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `expected encrypted DEK for slide but got ${keyRes.status()}`,
    ).toBeTruthy();
    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);

    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${slideId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok()).toBeTruthy();
    const rawText = (await downloadRes.body()).toString('utf8');
    expect(rawText, 'server must not store plaintext slide JSON').not.toContain('"slides"');
    expect(rawText, 'server must not store plaintext slide JSON').not.toContain('"theme"');
  });

  // ── Photos ─────────────────────────────────────────────────────────────────

  test('uploading a photo stores an encrypted DEK and encrypted bytes on the server', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const { token } = await loginUser(request, page);

    await page.goto('/photos');
    // Wait for currentUser to be loaded in React Query so the upload takes the E2EE path.
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 15_000 });

    // Create a small synthetic JPEG-like binary (1×1 pixel placeholder)
    const photoContent = 'E2EE-photo-test-payload-' + Date.now();
    const fileName = `e2e-photo-${Date.now()}.jpg`;

    const photoRegistrationPromise = page.waitForResponse(
      (r) => r.url().includes('/api/v1/photos') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Upload Photos', exact: true }).click(),
    ]);
    await fileChooser.setFiles({
      name: fileName,
      mimeType: 'image/jpeg',
      buffer: Buffer.from(photoContent, 'utf8'),
    });
    await photoRegistrationPromise;

    // Find the uploaded file via the photos API to get the backing drive file ID.
    const photosRes = await request.get(`${BASE_URL}/api/v1/photos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(photosRes.ok()).toBeTruthy();
    const { photos: photosList } = await photosRes.json() as { photos: { id: string; fileId: string }[] };
    expect(photosList.length, 'at least one photo must exist after upload').toBeGreaterThan(0);
    const fileId = photosList[0].fileId;

    // Verify encrypted DEK was stored
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `expected encrypted DEK for photo but got ${keyRes.status()}`,
    ).toBeTruthy();
    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);

    // Verify the stored bytes are not the original plaintext
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok()).toBeTruthy();
    const rawText = (await downloadRes.body()).toString('utf8');
    expect(rawText, 'server must not store plaintext photo content').not.toContain('E2EE-photo-test-payload');
  });
});
