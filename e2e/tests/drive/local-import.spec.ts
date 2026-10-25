/**
 * E2E: importing a folder from the computer (onboarding phase 4,
 * `agent_docs/plans/feature-onboarding-import.md`).
 *
 * Drive's New menu › "Import folders" opens the local import dialog. A folder
 * holding one of each kind — a picture, a Word file, a Markdown note and a
 * plain text file in a subfolder — is set on the folder input, the per-kind
 * summary is checked against the defaults, and the import runs. What it wrote
 * is then checked through the API rather than the UI, because the point is
 * where each file *landed*: the picture registered in Photos, the `.docx` in
 * Drive byte for byte under the folder structure, the `.md` as a
 * `text/markdown` note, the `.txt` in its subfolder.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BASE_URL = 'http://localhost:9880';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SAMPLE_DOCX = path.resolve(__dirname, '../../fixtures/sample.docx');

/** A valid 1×1 transparent PNG. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  folderId: string | null;
}

interface DriveFolder {
  id: string;
  name: string;
  parentId: string | null;
}

interface FolderContents {
  folders: DriveFolder[];
  files: DriveFile[];
}

function uniqueEmail(): string {
  return `local_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Local Import Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
}

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

async function getJson<T>(request: APIRequestContext, token: string, url: string): Promise<T> {
  const res = await request.get(`${BASE_URL}${url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `GET ${url} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

async function folderContents(request: APIRequestContext, token: string, folderId: string): Promise<FolderContents> {
  return getJson<FolderContents>(request, token, `/api/v1/drive/folders/${folderId}?limit=200`);
}

/** Lists `items` or `photos` or `files`, whichever the response carries. */
function listOf<T>(body: unknown, ...keys: string[]): T[] {
  if (Array.isArray(body)) return body as T[];
  const obj = body as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(obj[key])) return obj[key] as T[];
  }
  return [];
}

/**
 * Writes the fixture folder:
 *
 *   Holiday/
 *     beach.png
 *     report.docx
 *     ideas.md
 *     misc/readme.txt
 */
function makeFixtureFolder(): { root: string; folder: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neutrino-local-import-'));
  const folder = path.join(root, 'Holiday');
  fs.mkdirSync(path.join(folder, 'misc'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'beach.png'), PNG_1X1);
  fs.copyFileSync(SAMPLE_DOCX, path.join(folder, 'report.docx'));
  fs.writeFileSync(path.join(folder, 'ideas.md'), '# Ideas\n\n- one\n');
  fs.writeFileSync(path.join(folder, 'misc', 'readme.txt'), 'hello');
  return { root, folder };
}

test.describe('Drive — import folders from the computer', () => {
  let fixture: { root: string; folder: string };

  test.beforeEach(() => {
    fixture = makeFixtureFolder();
  });

  test.afterEach(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  test('imports a folder, sending each kind of file where it belongs', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);

    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Import folders' }).click();

    const dialog = page.getByRole('dialog', { name: 'Import folders' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // A webkitdirectory input takes a directory path; Playwright walks it.
    await dialog.getByTestId('local-import-folder-input').setInputFiles(fixture.folder);

    await expect(dialog.getByText('4 files').first()).toBeVisible({ timeout: 10_000 });

    // One row per kind, each defaulted to where that kind opens.
    await expect(dialog.getByRole('combobox', { name: 'Destination for Photos & videos' })).toHaveValue('photos-drive');
    await expect(dialog.getByRole('combobox', { name: 'Destination for Word, Excel, PowerPoint' })).toHaveValue('drive');
    await expect(dialog.getByRole('combobox', { name: 'Destination for Markdown notes' })).toHaveValue('notes');
    await expect(dialog.getByRole('combobox', { name: 'Destination for Everything else' })).toHaveValue('drive');

    await dialog.getByRole('button', { name: 'Import 4 files' }).click();

    // The run is handed to the background; the dialog (or the done pill)
    // reports the result.
    await expect(page.getByText(/Import finished/).first()).toBeVisible({ timeout: 60_000 });

    // ── The picture: a Drive file, and registered in Photos ─────────────────
    const photoFiles = listOf<DriveFile>(
      await getJson(request, token, '/api/v1/drive/files?type=photo&limit=50'),
      'files',
      'items',
    );
    const beach = photoFiles.find((f) => f.name === 'beach.png');
    expect(beach, 'beach.png must be listed as a photo in Drive').toBeTruthy();

    const photos = listOf<{ id: string; fileId: string }>(
      await getJson(request, token, '/api/v1/photos'),
      'photos',
      'items',
    );
    expect(
      photos.some((p) => p.fileId === beach!.id),
      'beach.png must be registered in the Photos library',
    ).toBe(true);

    // ── The folder structure, under My Drive ────────────────────────────────
    const me = await getJson<{ id: string }>(request, token, '/api/v1/auth/me');
    // A user's root folder id is their own user id.
    const root = await folderContents(request, token, me.id);
    const holiday = root.folders.find((f) => f.name === 'Holiday');
    expect(holiday, 'a Holiday folder must be created in My Drive').toBeTruthy();

    const inHoliday = await folderContents(request, token, holiday!.id);

    // ── The Word file: in Drive, as a .docx (opens in Docs) ─────────────────
    const report = inHoliday.files.find((f) => f.name === 'report.docx');
    expect(report, 'report.docx must be inside Holiday').toBeTruthy();
    expect(report!.mimeType).toBe(DOCX_MIME);

    // ── The Markdown file: a note, i.e. a text/markdown Drive file ──────────
    const ideas = inHoliday.files.find((f) => f.name === 'ideas.md');
    expect(ideas, 'ideas.md must be inside Holiday').toBeTruthy();
    expect(ideas!.mimeType).toBe('text/markdown');

    // ── The text file: in Drive, in its own subfolder ───────────────────────
    const misc = inHoliday.folders.find((f) => f.name === 'misc');
    expect(misc, 'a misc subfolder must be created inside Holiday').toBeTruthy();
    const inMisc = await folderContents(request, token, misc!.id);
    expect(inMisc.files.map((f) => f.name)).toContain('readme.txt');

    // Every file lands once — no duplicate folders from concurrent uploads.
    expect(root.folders.filter((f) => f.name === 'Holiday')).toHaveLength(1);
    expect(inHoliday.folders.filter((f) => f.name === 'misc')).toHaveLength(1);
  });

  test("the account menu's Import item opens /import", async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/drive');

    // Classic's topbar calls the button "User menu"; Flow/Blended's avatar
    // button is "Account". Either look may be the default for a new account.
    await page.getByRole('button', { name: /^(User menu|Account)$/ }).first().click();
    await page.getByRole('menuitem', { name: 'Import' }).click();

    await expect(page).toHaveURL(/\/import/, { timeout: 10_000 });
  });
});
