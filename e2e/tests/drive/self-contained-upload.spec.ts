/**
 * Self-contained uploads (neutrino_drive_ios_mobile#38).
 *
 * `POST /api/v1/drive/files/upload` may carry the uploader's sealed file key
 * and the file's own dates as extra multipart fields, written in the same
 * transaction as the file row. A background client then has nothing left to
 * send after the body lands. These specs drive the API directly: the fields
 * have no browser UI.
 */
import { test, expect } from '../../fixtures/base';
import type { APIRequestContext } from '@playwright/test';
import { randomBytes } from 'crypto';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `upload_extras_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** A random 32-byte value in the base64url shape of a Curve25519 public key. */
function fakePublicKey(): string {
  return randomBytes(32).toString('base64url');
}

async function registerAndLogin(request: APIRequestContext): Promise<string> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const reg = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Upload Extras User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(reg.ok(), `register failed: ${reg.status()} ${await reg.text()}`).toBeTruthy();
  const res = await request.post(`${BASE_URL}/api/v1/auth/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { accessToken?: string; access_token?: string };
  return (body.accessToken ?? body.access_token)!;
}

/** Publish a new keyring version and return its number. */
async function publishKey(request: APIRequestContext, token: string): Promise<number> {
  const res = await request.post(`${BASE_URL}/api/v1/auth/keys`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { publicKey: fakePublicKey() },
  });
  expect(res.ok(), `publish key failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { version: number }).version;
}

/** Text fields first: the server reads them before the file part. */
function upload(request: APIRequestContext, token: string, fields: Record<string, string>) {
  return request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      ...fields,
      file: {
        name: 'IMG_0001.HEIC',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('ciphertext'),
      },
    },
  });
}

async function fileKey(request: APIRequestContext, token: string, fileId: string) {
  return request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/key`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test.describe('Self-contained upload', () => {
  test('stores the sealed key sent with the upload', async ({ request }) => {
    const token = await registerAndLogin(request);
    const version = await publishKey(request, token);

    const res = await upload(request, token, {
      encrypted_file_key: 'sealed-dek',
      key_version: String(version),
    });
    expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const { id } = (await res.json()) as { id: string };

    const key = await fileKey(request, token, id);
    expect(key.ok()).toBeTruthy();
    expect(await key.json()).toMatchObject({ encryptedFileKey: 'sealed-dek', keyVersion: version });
  });

  test('accepts a key sealed to a retired keyring version', async ({ request }) => {
    const token = await registerAndLogin(request);
    const retired = await publishKey(request, token);
    await publishKey(request, token);

    const res = await upload(request, token, {
      encrypted_file_key: 'sealed-to-old-key',
      key_version: String(retired),
    });
    expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const { id } = (await res.json()) as { id: string };

    const key = await fileKey(request, token, id);
    expect(await key.json()).toMatchObject({ keyVersion: retired });
  });

  test('refuses a key version the account never published', async ({ request }) => {
    const token = await registerAndLogin(request);
    const version = await publishKey(request, token);

    const res = await upload(request, token, {
      encrypted_file_key: 'sealed-dek',
      key_version: String(version + 5),
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'UNKNOWN_KEY_VERSION' } });
  });

  test('refuses key_version without encrypted_file_key', async ({ request }) => {
    const token = await registerAndLogin(request);
    await publishKey(request, token);

    const res = await upload(request, token, { key_version: '1' });
    expect(res.status()).toBe(400);
  });

  test('keeps the dates sent with the upload', async ({ request }) => {
    const token = await registerAndLogin(request);

    const res = await upload(request, token, {
      created_at: '2014-03-01T12:00:00Z',
      updated_at: '2014-03-02T08:30:00Z',
    });
    expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const file = (await res.json()) as { createdAt: string; updatedAt: string; importedAt: string | null };
    expect(file.createdAt).toMatch(/^2014-03-01T12:00:00/);
    expect(file.updatedAt).toMatch(/^2014-03-02T08:30:00/);
    expect(file.importedAt).toBeNull();
  });

  test('refuses a date it cannot read', async ({ request }) => {
    const token = await registerAndLogin(request);

    const res = await upload(request, token, { created_at: 'last tuesday' });
    expect(res.status()).toBe(400);
  });

  test('records import provenance when import_source is sent', async ({ request }) => {
    const token = await registerAndLogin(request);

    const res = await upload(request, token, {
      created_at: '2014-03-01T12:00:00Z',
      import_source: 'photo-sync:ABC/L0/001',
    });
    expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const file = (await res.json()) as { importSource: string | null; importedAt: string | null };
    expect(file.importSource).toBe('photo-sync:ABC/L0/001');
    expect(file.importedAt).not.toBeNull();
  });
});
