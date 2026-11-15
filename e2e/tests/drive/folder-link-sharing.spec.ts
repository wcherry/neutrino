/**
 * Folder links with a password, and guest sessions that end with the link (#321).
 *
 * Driven through the API: the property under test is what the server lets a guest do, and the
 * browser half (link key in the fragment, decryption) is covered by the web unit tests. Files here
 * are plaintext uploads, which is enough to exercise who may reach what.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '../../fixtures/base';
import type { APIRequestContext } from '@playwright/test';
import { setUpEncryption } from '../../fixtures/e2ee';
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

  /**
   * A folder can be shared from Drive at all: its menu has Share, the dialog opens for the folder,
   * and creating a link there gives it a key (and the owner a sealed copy of it) — which is what
   * makes the link usable for encrypted files.
   */
  test('a folder is shared by link from its menu in Drive', async ({ page, request }) => {
    const email = uniqueEmail();
    const reg = await request.post(`${BASE_URL}/api/v1/auth/register`, {
      data: { name: 'Folder Sharer', email, password: 'Password123!' },
    });
    expect(reg.ok()).toBeTruthy();
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('Password123!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
    await setUpEncryption(page);
    const token = (await page.evaluate(() => localStorage.getItem('access_token')))!;

    const name = `Shared from menu ${Date.now()}`;
    const created = await request.post(`${BASE_URL}/api/v1/drive/folders`, {
      headers: bearer(token),
      data: { name },
    });
    const folderId = ((await created.json()) as { id: string }).id;

    await page.goto('/drive');
    await page.getByRole('button', { name: `More options for ${name}` }).click();
    await page.getByRole('menu', { name: 'Folder options' }).getByRole('menuitem', { name: 'Share' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(name).first()).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Create link' }).click();
    await expect(dialog.getByRole('button', { name: /Copy link/ })).toBeEnabled({ timeout: 15_000 });
    await expect(dialog.getByText(/carries the key that unlocks these files/)).toBeVisible();

    const link = await request.get(`${BASE_URL}/api/v1/drive/folders/${folderId}/share-link`, {
      headers: bearer(token),
    });
    expect(link.ok()).toBeTruthy();
    const body = (await link.json()) as { publicKey: string | null; sealedSeed: string | null };
    expect(body.publicKey, 'a folder link made in the dialog carries a link key').toBeTruthy();
    expect(body.sealedSeed, 'and the owner keeps a sealed copy of its seed').toBeTruthy();
  });

  /**
   * The guest's folder page as a visitor sees it: readable in the dark theme, with Drive's three
   * views and a search box. A link with no key and plaintext files is enough here — the page lists
   * and filters the same way whatever the files hold.
   */
  test('the guest folder page has views and search, and is readable in the dark theme', async ({
    page,
    request,
  }, testInfo) => {
    const owner = await registerAndLogin(request);
    const folder = await request.post(`${BASE_URL}/api/v1/drive/folders`, {
      headers: bearer(owner),
      data: { name: 'Las Vegas' },
    });
    const folderId = ((await folder.json()) as { id: string }).id;
    for (const name of ['IMG_2738.JPG', 'IMG_2739.JPG', 'notes.txt']) {
      await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
        headers: bearer(owner),
        multipart: { folder_id: folderId, file: { name, mimeType: 'text/plain', buffer: Buffer.from(name) } },
      });
    }
    const link = await request.put(`${BASE_URL}/api/v1/drive/folders/${folderId}/share-link`, {
      headers: bearer(owner),
      data: { visibility: 'anyoneWithLink', role: 'editor' },
    });
    const token = ((await link.json()) as { token: string }).token;

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/share?token=${token}`);
    const title = page.getByRole('heading', { name: 'Las Vegas' });
    await expect(title).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('IMG_2738.JPG')).toBeVisible();

    // Readable: the heading's colour is not the card's colour.
    const [fg, bg] = await title.evaluate((el) => {
      const card = el.closest('[class*="browserCard"]') as HTMLElement;
      return [getComputedStyle(el).color, getComputedStyle(card).backgroundColor];
    });
    expect(fg).not.toBe(bg);
    await page.screenshot({ path: testInfo.outputPath('share-dark-list.png') });

    // Search narrows the listing to matching names.
    await page.getByRole('searchbox', { name: 'Search this folder' }).fill('2739');
    await expect(page.getByText('IMG_2739.JPG')).toBeVisible();
    await expect(page.getByText('IMG_2738.JPG')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search this folder' }).fill('');

    // The three views, as in Drive.
    const views = page.getByRole('group', { name: 'View mode' });
    await views.getByRole('button', { name: 'Large grid' }).click();
    await expect(views.getByRole('button', { name: 'Large grid' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('notes.txt')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('share-dark-large.png') });
    await views.getByRole('button', { name: 'Small grid' }).click();
    await expect(views.getByRole('button', { name: 'Small grid' })).toHaveAttribute('aria-pressed', 'true');

    // Click previews a file; ←/→ step through; Esc closes.
    await views.getByRole('button', { name: 'Detailed list' }).click();
    await page.getByRole('button', { name: 'notes.txt', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Preview of notes.txt' });
    await expect(preview).toBeVisible();
    await expect(preview.getByText('notes.txt', { exact: true }).last()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('share-dark-preview.png') });
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('dialog', { name: 'Preview of IMG_2739.JPG' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // ⌘/Ctrl-click selects without opening; Download zips the selection.
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.getByRole('button', { name: 'IMG_2738.JPG', exact: true }).click({ modifiers: [modifier] });
    await page.getByRole('button', { name: 'notes.txt', exact: true }).click({ modifiers: [modifier] });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const bar = page.getByRole('toolbar', { name: 'Selected items' });
    await expect(bar.getByText('2 selected')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('share-dark-selected.png') });
    const [zip] = await Promise.all([
      page.waitForEvent('download'),
      bar.getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(zip.suggestedFilename()).toBe('Las Vegas.zip');

    // Delete the selection (to the owner's trash).
    await bar.getByRole('button', { name: 'Delete' }).click();
    await bar.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: 'notes.txt', exact: true })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'IMG_2739.JPG', exact: true })).toBeVisible();

    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    await expect(page.getByText('IMG_2739.JPG')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath('share-light-small.png') });
  });

  /**
   * Every file type the app itself opens previews on a folder link, drawn by the same views as
   * Drive's preview. Plaintext uploads (a link without a key) are enough: the readers and views are
   * what is under test, and a keyed link only changes how the bytes are decrypted.
   */
  test('every app file type previews on the guest page', async ({ page, request }, testInfo) => {
    const owner = await registerAndLogin(request);
    const folder = await request.post(`${BASE_URL}/api/v1/drive/folders`, {
      headers: bearer(owner),
      data: { name: `App types ${Date.now()}` },
    });
    const folderId = ((await folder.json()) as { id: string }).id;
    const fixture = (f: string) => fs.readFileSync(path.join(__dirname, '../../fixtures', f));
    const diagram = JSON.stringify({
      version: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      pages: [
        {
          id: 'p1',
          name: 'Page 1',
          connectors: [],
          shapes: [
            {
              id: 'sh1',
              type: 'rectangle',
              x: 10, y: 20, width: 160, height: 60,
              label: 'Start here',
              style: { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1, fontSize: 14, fontFamily: 'Inter', textColor: '#111111' },
            },
          ],
        },
      ],
    });
    const files: [string, string, Buffer][] = [
      ['Report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fixture('sample.docx')],
      ['Budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fixture('sample.xlsx')],
      ['Deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', fixture('sample.pptx')],
      ['Packing.md', 'text/markdown', Buffer.from('# Packing list\n\n- Passport\n- Charger\n')],
      ['Flow', 'application/x-neutrino-diagram', Buffer.from(diagram)],
      ['Sketch', 'application/x-neutrino-drawing', fixture('sample.drawing.json')],
    ];
    for (const [name, mimeType, buffer] of files) {
      const up = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
        headers: bearer(owner),
        multipart: { folder_id: folderId, mime_type: mimeType, file: { name, mimeType, buffer } },
      });
      expect(up.ok(), `upload ${name}: ${up.status()}`).toBeTruthy();
    }
    const link = await request.put(`${BASE_URL}/api/v1/drive/folders/${folderId}/share-link`, {
      headers: bearer(owner),
      data: { visibility: 'anyoneWithLink', role: 'viewer' },
    });
    const token = ((await link.json()) as { token: string }).token;
    await page.goto(`/share?token=${token}`);

    const open = async (name: string) => {
      await page.getByRole('button', { name, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `Preview of ${name}` });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      return dialog;
    };
    const close = async (dialog: ReturnType<typeof page.getByRole>, shot: string) => {
      await expect(dialog.getByText('There is no preview for this kind of file.')).toHaveCount(0);
      await expect(dialog.getByText(/Could not|Failed to/)).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`preview-${shot}.png`) });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    };

    let d = await open('Report.docx');
    await expect(d.locator('[class*="docContent"]')).toBeVisible({ timeout: 15_000 });
    await close(d, 'docx');

    d = await open('Budget.xlsx');
    await expect(d.getByRole('table', { name: 'Spreadsheet preview' })).toBeVisible({ timeout: 15_000 });
    await close(d, 'xlsx');

    d = await open('Deck.pptx');
    await expect(d.locator('[class*="slidePreviewItem"]').first()).toBeVisible({ timeout: 15_000 });
    // The deck's text, on its white background (theme colour roles mapped, not defaulted to black).
    await expect(d.getByText('Neutrino office round-trip fixture')).toBeVisible();
    await close(d, 'pptx');

    d = await open('Packing.md');
    await expect(d.getByRole('heading', { name: 'Packing list' })).toBeVisible({ timeout: 15_000 });
    await expect(d.getByText('Passport')).toBeVisible();
    await close(d, 'md');

    d = await open('Flow');
    await expect(d.getByText('Start here')).toBeVisible({ timeout: 15_000 });
    await close(d, 'diagram');

    d = await open('Sketch');
    await expect(d.getByText('This drawing is empty.')).toBeVisible({ timeout: 15_000 });
    await close(d, 'drawing');
  });
});
