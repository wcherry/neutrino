/**
 * Folder links with a password, and guest sessions that end with the link (#321).
 *
 * Driven through the API: the property under test is what the server lets a guest do, and the
 * browser half (link key in the fragment, decryption) is covered by the web unit tests. Files here
 * are plaintext uploads, which is enough to exercise who may reach what.
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

  test('an editor guest lists, uploads, organises and trashes inside the folder', async ({
    request,
  }) => {
    const { owner, folderId, fileId, token } = await setUp(request);
    const guest = await openSession(request, token, PASSWORD);

    const listed = await request.get(`${BASE_URL}/api/v1/share/folder/${folderId}`, {
      headers: bearer(guest),
    });
    expect(listed.ok(), `list: ${listed.status()} ${await listed.text()}`).toBeTruthy();
    const contents = (await listed.json()) as {
      rootFolderId: string;
      role: string;
      files: { id: string }[];
    };
    expect(contents.rootFolderId).toBe(folderId);
    expect(contents.role).toBe('editor');
    expect(contents.files.map((f) => f.id)).toContain(fileId);

    const sub = await request.post(`${BASE_URL}/api/v1/share/folder/${folderId}/folders`, {
      headers: bearer(guest),
      data: { name: 'From guest' },
    });
    expect(sub.ok(), `create folder: ${sub.status()}`).toBeTruthy();
    const subId = ((await sub.json()) as { id: string }).id;

    const upload = await request.post(`${BASE_URL}/api/v1/share/folder/upload`, {
      headers: bearer(guest),
      multipart: {
        folder_id: subId,
        file: { name: 'guest.txt', mimeType: 'text/plain', buffer: Buffer.from('from a guest') },
      },
    });
    expect(upload.ok(), `guest upload: ${upload.status()} ${await upload.text()}`).toBeTruthy();
    const uploadedId = ((await upload.json()) as { id: string }).id;

    // The upload is the owner's file, and the owner reads it as their own.
    const ownerRead = await request.get(`${BASE_URL}/api/v1/drive/files/${uploadedId}`, {
      headers: bearer(owner),
    });
    expect(await ownerRead.text()).toBe('from a guest');

    const renamed = await request.patch(`${BASE_URL}/api/v1/share/files/${uploadedId}`, {
      headers: bearer(guest),
      data: { name: 'renamed.txt', folderId },
    });
    expect(renamed.ok(), `rename + move: ${renamed.status()}`).toBeTruthy();

    const trashed = await request.delete(`${BASE_URL}/api/v1/share/files/${fileId}`, {
      headers: bearer(guest),
    });
    expect(trashed.status()).toBe(204);
    const trash = await request.get(`${BASE_URL}/api/v1/drive/trash`, { headers: bearer(owner) });
    expect(JSON.stringify(await trash.json())).toContain(fileId);

    // The shared folder itself is the owner's to change.
    const root = await request.delete(`${BASE_URL}/api/v1/share/folders/${folderId}`, {
      headers: bearer(guest),
    });
    expect(root.status()).toBe(403);
  });

  test('a guest cannot reach outside the folder, and a viewer cannot write', async ({
    request,
  }) => {
    const { owner, folderId, token } = await setUp(request);
    const guest = await openSession(request, token, PASSWORD);

    const elsewhere = await request.post(`${BASE_URL}/api/v1/drive/folders`, {
      headers: bearer(owner),
      data: { name: `Private ${Date.now()}` },
    });
    const elsewhereId = ((await elsewhere.json()) as { id: string }).id;
    const outside = await request.get(`${BASE_URL}/api/v1/share/folder/${elsewhereId}`, {
      headers: bearer(guest),
    });
    expect(outside.status()).toBe(404);
    const intoOutside = await request.post(`${BASE_URL}/api/v1/share/folder/${elsewhereId}/folders`, {
      headers: bearer(guest),
      data: { name: 'nope' },
    });
    expect(intoOutside.status()).toBe(404);

    // Down to view-only: no password change, so the same session carries on, now read-only.
    const viewer = await request.patch(`${BASE_URL}/api/v1/drive/folders/${folderId}/share-link`, {
      headers: bearer(owner),
      data: { role: 'viewer' },
    });
    expect(viewer.ok()).toBeTruthy();
    const listed = await request.get(`${BASE_URL}/api/v1/share/folder/${folderId}`, {
      headers: bearer(guest),
    });
    expect(listed.ok()).toBeTruthy();
    const write = await request.post(`${BASE_URL}/api/v1/share/folder/${folderId}/folders`, {
      headers: bearer(guest),
      data: { name: 'nope' },
    });
    expect(write.status()).toBe(403);
  });
});
