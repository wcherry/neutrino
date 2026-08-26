/**
 * E2E: native round-trip editing of a raw .docx file (issue #43 — in-place
 * editing of MS Office docs).
 *
 * Uploads e2e/fixtures/sample.docx, opens it (must land in the Docs editor,
 * not the "preview not available" modal), edits it, reloads to confirm the
 * edit persisted, then downloads the raw file again and sanity-checks it is
 * still a structurally valid OOXML zip (not a full Office-compatible parse —
 * just confirms the well-known zip magic bytes and the mandatory
 * `[Content_Types].xml` part are present, per the plan's acceptance criteria).
 *
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption, downloadDecrypted } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:9880';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FIXTURE_PATH = path.resolve(__dirname, '../../fixtures/sample.docx');

function uniqueEmail(): string {
  return `docs_office_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Docs Office Test User', email, password },
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

async function getUserId(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `profile fetch failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

async function uploadSampleDocx(request: APIRequestContext, token: string): Promise<string> {
  const buffer = fs.readFileSync(FIXTURE_PATH);
  const res = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: 'sample.docx', mimeType: DOCX_MIME, buffer },
    },
  });
  expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = (await res.json()) as { id: string };
  return data.id;
}

/** Structural-only OOXML validity check: real zip magic + mandatory part present. */
function assertValidOoxmlZip(buffer: Buffer) {
  const zipMagic = buffer.subarray(0, 4).toString('latin1');
  expect(['PK\x03\x04', 'PK\x05\x06']).toContain(zipMagic);
  expect(buffer.includes(Buffer.from('[Content_Types].xml'))).toBeTruthy();
  expect(buffer.includes(Buffer.from('word/document.xml'))).toBeTruthy();
  // No `neutrino/model.json`: a document used to carry a full second copy of
  // itself beside the Word document, because the writer of the day was a lossy
  // projection. `word/document.xml` is now the document, and a sidecar here
  // would mean a save had quietly gone back to writing one.
  expect(buffer.includes(Buffer.from('neutrino/model.json'))).toBeFalsy();
}

test.describe('Docs — office round-trip editing', () => {
  test('opening a raw .docx lands in the Docs editor, not the preview modal', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileId = await uploadSampleDocx(request, token);

    await page.goto('/drive');
    await page.getByRole('listitem', { name: 'sample.docx' }).first().click();

    await expect(page).toHaveURL(new RegExp(`/docs/editor/?\\?id=${fileId}`), { timeout: 15_000 });
    await expect(page.getByText('preview not available', { exact: false })).not.toBeVisible();
    await expect(page.getByText('Neutrino office round-trip fixture')).toBeVisible({ timeout: 10_000 });
  });

  test('editing content, reloading, and downloading preserves the edit as valid OOXML', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileId = await uploadSampleDocx(request, token);

    await page.goto(`/docs/editor?id=${fileId}`);
    await expect(page.getByText('Neutrino office round-trip fixture')).toBeVisible({ timeout: 10_000 });

    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' — edited in place');

    // Wait for autosave to fire (see plan: every save re-serializes to real
    // OOXML bytes as a new version of the same file).
    await page.waitForTimeout(4_000);

    await page.reload();
    await expect(page.getByText('edited in place', { exact: false })).toBeVisible({ timeout: 15_000 });

    // Decrypted, because an office-mode save is E2EE like every other save
    // (issue #95): the bytes in storage are ciphertext, and the OOXML the user
    // gets is what Drive's download produces after decrypting them here.
    const userId = await getUserId(request, token);
    assertValidOoxmlZip(
      await downloadDecrypted(page, request, { baseUrl: BASE_URL, token, userId, fileId }),
    );
  });

  test('the file keeps the same id, name, and mimetype after editing (native round-trip)', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileId = await uploadSampleDocx(request, token);

    await page.goto(`/docs/editor?id=${fileId}`);
    await expect(page.getByText('Neutrino office round-trip fixture')).toBeVisible({ timeout: 10_000 });
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.type(' more text');
    await page.waitForTimeout(4_000);

    const metaRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/metadata`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(metaRes.ok()).toBeTruthy();
    const meta = (await metaRes.json()) as { id: string; name: string; mimeType: string };
    expect(meta.id).toBe(fileId);
    expect(meta.name).toBe('sample.docx');
    expect(meta.mimeType).toBe(DOCX_MIME);
  });
});
