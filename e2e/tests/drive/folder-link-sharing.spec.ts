/**
 * Folder links with a password, and guest sessions that end with the link (#321).
 *
 * Driven through the API: the property under test is what the server lets a guest do, and the
 * browser half (link key in the fragment, decryption) is covered by the web unit tests.
 *
 * **What is deliberately not covered here.** The guest folder API (`/api/v1/share/folder/...`) is
 * gated by `folderLinkEditing`, which is off by default, and this suite has no way to make an admin
 * to turn it on (see `tests/settings/feature-flags.spec.ts` for why). It is checked here only as
 * off — a 404 — and its behaviour with the flag on is covered by the Rust tests in
 * `src/drive/link_folders/tests.rs`, which run the same services against a real database.
 */
import { test, expect } from '../../fixtures/base';
import type { APIRequestContext } from '@playwright/test';
import { randomBytes } from 'crypto';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'hunter22';

function uniqueEmail(): string {
  return `folder_link_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext): Promise<string> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const reg = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Folder Link Owner', email, password },
  });
  expect(reg.ok(), `register failed: ${reg.status()} ${await reg.text()}`).toBeTruthy();
  const res = await request.post(`${BASE_URL}/api/v1/auth/login`, { data: { email, password } });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { accessToken?: string; access_token?: string };
  return (body.accessToken ?? body.access_token)!;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Fixture {
  owner: string;
  folderId: string;
  fileId: string;
  token: string;
}

/** An owner, a folder holding one file, and an editor link on the folder with a password. */
async function setUp(request: APIRequestContext): Promise<Fixture> {
  const owner = await registerAndLogin(request);

  const folder = await request.post(`${BASE_URL}/api/v1/drive/folders`, {
    headers: bearer(owner),
    data: { name: `Shared ${Date.now()}` },
  });
  expect(folder.ok(), `create folder: ${folder.status()}`).toBeTruthy();
  const folderId = ((await folder.json()) as { id: string }).id;

  const upload = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: bearer(owner),
    multipart: {
      folder_id: folderId,
      file: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
    },
  });
  expect(upload.ok(), `upload: ${upload.status()}`).toBeTruthy();
  const fileId = ((await upload.json()) as { id: string }).id;

  const link = await request.put(`${BASE_URL}/api/v1/drive/folders/${folderId}/share-link`, {
    headers: bearer(owner),
    data: {
      visibility: 'anyoneWithLink',
      role: 'editor',
      password: PASSWORD,
      publicKey: randomBytes(32).toString('base64url'),
      sealedSeed: 'sealed-to-owner',
      sealedSeedKeyVersion: 1,
    },
  });
  expect(link.ok(), `create link: ${link.status()} ${await link.text()}`).toBeTruthy();
  const body = (await link.json()) as { token: string; hasPassword: boolean; keySubject: string };
  expect(body.hasPassword).toBe(true);
  expect(body.keySubject).toMatch(/^guest:/);

  return { owner, folderId, fileId, token: body.token };
}

async function openSession(
  request: APIRequestContext,
  token: string,
  password?: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/share/${token}/session`, {
    data: password ? { password } : {},
  });
  expect(res.ok(), `session: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test.describe('Folder link with a password', () => {
  test('reveals nothing until the password is given', async ({ request }) => {
    const { token } = await setUp(request);

    const resolved = await request.get(`${BASE_URL}/api/v1/share/${token}`);
    expect(resolved.ok()).toBeTruthy();
    const body = (await resolved.json()) as Record<string, unknown>;
    expect(body.passwordRequired).toBe(true);
    expect(body.resourceType).toBe('folder');
    expect(body.resourceId).toBe('');
    expect(body.resourceName).toBe('');

    const missing = await request.post(`${BASE_URL}/api/v1/share/${token}/session`, { data: {} });
    expect(missing.status()).toBe(401);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe(
      'SHARE_PASSWORD_REQUIRED',
    );

    const wrong = await request.post(`${BASE_URL}/api/v1/share/${token}/session`, {
      data: { password: 'not-it' },
    });
    expect(wrong.status()).toBe(401);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe(
      'SHARE_PASSWORD_INVALID',
    );

    const ok = await request.post(`${BASE_URL}/api/v1/share/${token}/session`, {
      data: { password: PASSWORD },
    });
    expect(ok.ok()).toBeTruthy();
    const session = (await ok.json()) as { role: string; resourceType: string; publicKey: string };
    expect(session.role).toBe('editor');
    expect(session.resourceType).toBe('folder');
    expect(session.publicKey).toBeTruthy();
  });

  test('a guest reads files inside the folder and nothing else', async ({ request }) => {
    const { owner, fileId, folderId, token } = await setUp(request);
    const guest = await openSession(request, token, PASSWORD);

    const read = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: bearer(guest),
    });
    expect(read.ok(), `guest read: ${read.status()}`).toBeTruthy();
    expect(await read.text()).toBe('hello');

    // A file of the same owner outside the shared folder.
    const outside = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
      headers: bearer(owner),
      multipart: { file: { name: 'private.txt', mimeType: 'text/plain', buffer: Buffer.from('no') } },
    });
    const outsideId = ((await outside.json()) as { id: string }).id;
    const denied = await request.get(`${BASE_URL}/api/v1/drive/files/${outsideId}`, {
      headers: bearer(guest),
    });
    expect(denied.ok()).toBeFalsy();

    // A guest can never manage the link.
    const manage = await request.patch(`${BASE_URL}/api/v1/drive/folders/${folderId}/share-link`, {
      headers: bearer(guest),
      data: { role: 'viewer' },
    });
    expect(manage.status()).toBe(403);
  });

  test('turning the link off ends the guest session at once', async ({ request }) => {
    const { owner, fileId, folderId, token } = await setUp(request);
    const guest = await openSession(request, token, PASSWORD);

    const off = await request.patch(`${BASE_URL}/api/v1/drive/folders/${folderId}/share-link`, {
      headers: bearer(owner),
      data: { isActive: false },
    });
    expect(off.ok()).toBeTruthy();

    const after = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: bearer(guest),
    });
    expect(after.ok()).toBeFalsy();
  });

  test('changing the password ends sessions opened with the old one', async ({ request }) => {
    const { owner, fileId, folderId, token } = await setUp(request);
    const guest = await openSession(request, token, PASSWORD);

    const change = await request.patch(`${BASE_URL}/api/v1/drive/folders/${folderId}/share-link`, {
      headers: bearer(owner),
      data: { password: 'another1' },
    });
    expect(change.ok()).toBeTruthy();

    const stale = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: bearer(guest),
    });
    expect(stale.ok()).toBeFalsy();

    const fresh = await openSession(request, token, 'another1');
    const read = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: bearer(fresh),
    });
    expect(read.ok()).toBeTruthy();
  });

  test('the guest folder API is off by default', async ({ request }) => {
    const { folderId, token } = await setUp(request);
    const guest = await openSession(request, token, PASSWORD);
    const res = await request.get(`${BASE_URL}/api/v1/share/folder/${folderId}`, {
      headers: bearer(guest),
    });
    expect(res.status()).toBe(404);
  });
});
