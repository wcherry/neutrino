/**
 * Notes E2EE encryption tests.
 *
 * Verifies the same two properties the docs/sheets/slides encryption specs
 * verify, applied to the Notes app:
 *   1. The server holds an encrypted DEK (data encryption key) for the note's
 *      backing drive file.
 *   2. The raw stored bytes are ciphertext — not the plaintext BlockEditor
 *      JSON or any text the user typed.
 *
 * A third test guards the tricky part of wiring Notes into E2EE: backlinks
 * are built server-side by parsing `[[wiki links]]` out of note content, but
 * once content is ciphertext the server can no longer read it. That link
 * extraction must happen client-side and be sent alongside the encrypted
 * content, or the backlinks feature silently breaks.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `e2e_note_enc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Note Enc User', email, password },
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

/** Create a note via the API and return its ID. */
async function createNoteViaApi(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/notes`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title },
  });
  expect(res.ok(), `create note failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

/** Click the first block view area to enter edit mode and fill it with content, then blur. */
async function typeInFirstBlock(page: Page, content: string): Promise<void> {
  await page.getByText('Start writing…', { exact: false }).locator('xpath=..').click();
  const blockInput = page.getByRole('textbox', { name: 'Block 1' });
  await expect(blockInput).toBeVisible({ timeout: 5_000 });
  await blockInput.fill(content);
  await page.getByLabel('Note title').click();
  await expect(blockInput).not.toBeVisible({ timeout: 5_000 });
}

test.describe('Notes E2EE encryption', () => {
  test('creating a note via the UI stores an encrypted DEK on the server', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    // Wait for the E2EE keypair so the note editor's DEK resolution uses the encrypted path.
    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    await page.goto('/notes');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Notes', {
      timeout: 10_000,
    });

    // Register the listener before clicking to avoid a race where the DEK
    // is created before waitForResponse is set up.
    const keyPutPromise = page.waitForResponse(
      (r) => r.url().includes('/api/v1/drive/files/') && r.url().endsWith('/key') && r.request().method() === 'PUT',
      { timeout: 20_000 },
    );

    await page.getByRole('button', { name: /new note/i }).first().click();
    await expect(page).toHaveURL(/\/notes\/editor\/?\?id=/, { timeout: 15_000 });

    const noteId = new URL(page.url()).searchParams.get('id')!;
    expect(noteId, 'note ID must be present in URL').toBeTruthy();

    // Wait for the note editor to establish the DEK for this file.
    await keyPutPromise;

    // The server must store an encrypted DEK for this file.
    const keyRes = await request.get(`${BASE_URL}/api/v1/drive/files/${noteId}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      keyRes.ok(),
      `server must hold an encrypted DEK for the note (got ${keyRes.status()})`,
    ).toBeTruthy();

    const keyData = await keyRes.json() as { encryptedFileKey: string };
    expect(typeof keyData.encryptedFileKey, 'encryptedFileKey must be a string').toBe('string');
    expect(keyData.encryptedFileKey.length, 'encryptedFileKey must be non-empty').toBeGreaterThan(0);
  });

  test('note text typed by the user and autosaved is stored as ciphertext', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    const noteId = await createNoteViaApi(request, token, 'Encryption Target Note');

    const keyPutPromise = page.waitForResponse(
      (r) => r.url().includes(`/api/v1/drive/files/${noteId}/key`) && r.request().method() === 'PUT',
      { timeout: 20_000 },
    );

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    // Wait for the editor to establish the DEK before typing, so the autosave
    // that follows definitely goes through the encrypted path.
    await keyPutPromise;

    const secretPhrase = `confidential-note-${Date.now()}-secret-payload`;

    const saveResPromise = page.waitForResponse(
      (r) => r.url().includes(`/api/v1/notes/${noteId}`) && r.request().method() === 'PATCH',
      { timeout: 30_000 },
    );

    await typeInFirstBlock(page, secretPhrase);

    const saveRes = await saveResPromise;
    expect(saveRes.ok(), `autosave must succeed (got ${saveRes.status()})`).toBeTruthy();

    // Download the raw bytes the server holds for this note's backing file.
    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${noteId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok(), `download failed: ${downloadRes.status()}`).toBeTruthy();
    const rawText = (await downloadRes.body()).toString('utf8');

    expect(rawText, 'server must not expose typed note text in plaintext').not.toContain(secretPhrase);
    expect(rawText, 'server must not expose "confidential" in plaintext').not.toContain('confidential-note');
    expect(rawText, 'server must not store BlockEditor JSON structure in plaintext').not.toContain('"type":"paragraph"');
  });

  test('wiki-links still resolve into backlinks even though note content is encrypted', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    const targetTitle = `Backlink Target ${Date.now()}`;
    const targetId = await createNoteViaApi(request, token, targetTitle);
    const sourceId = await createNoteViaApi(request, token, 'Backlink Source');

    const keyPutPromise = page.waitForResponse(
      (r) => r.url().includes(`/api/v1/drive/files/${sourceId}/key`) && r.request().method() === 'PUT',
      { timeout: 20_000 },
    );

    await page.goto(`/notes/editor?id=${sourceId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });
    await keyPutPromise;

    const saveResPromise = page.waitForResponse(
      (r) => r.url().includes(`/api/v1/notes/${sourceId}`) && r.request().method() === 'PATCH',
      { timeout: 30_000 },
    );

    await typeInFirstBlock(page, `See [[${targetTitle}]] for more.`);
    await saveResPromise;

    const backlinksRes = await request.get(`${BASE_URL}/api/v1/notes/${targetId}/backlinks`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(backlinksRes.ok(), `backlinks fetch failed: ${backlinksRes.status()}`).toBeTruthy();
    const data = await backlinksRes.json() as { backlinks: { id: string; title: string }[] };
    expect(
      data.backlinks.map((b) => b.id),
      'encrypted source note must still register as a backlink on the target note',
    ).toContain(sourceId);
  });

  test('a pre-existing (legacy, unencrypted) note still loads correctly', async ({
    page,
    request,
  }) => {
    // Simulates a note saved before this note ever went through the E2EE
    // editor flow — real plaintext content, no DEK ever registered. Written
    // directly via the API (not the UI) to bypass client-side encryption.
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const userId = await getUserId(request, token);

    await page.waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      `neutrino_e2e_${userId}`,
      { timeout: 10_000 },
    );

    const noteId = await createNoteViaApi(request, token, 'Legacy Note');
    const legacyContent = JSON.stringify([
      { id: 'legacy1', type: 'paragraph', content: 'Legacy plaintext content' },
    ]);
    const patchRes = await request.patch(`${BASE_URL}/api/v1/notes/${noteId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { content: legacyContent },
    });
    expect(patchRes.ok(), `legacy content seed failed: ${patchRes.status()}`).toBeTruthy();

    // First open: no key ref exists yet, so a DEK gets generated and
    // registered (isNewEncryption), but the legacy plaintext content must
    // still be read and rendered as-is, not treated as ciphertext.
    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Legacy plaintext content')).toBeVisible({ timeout: 10_000 });

    // Second open (reload): a key ref now exists (registered on first open),
    // so the client will attempt to decrypt — but the stored content is
    // still the same legacy plaintext (never re-encrypted, since the user
    // hasn't saved anything yet). Decryption must fail gracefully and fall
    // back to the raw content instead of leaving the editor blank or broken.
    await page.reload();
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Legacy plaintext content')).toBeVisible({ timeout: 10_000 });
  });
});
