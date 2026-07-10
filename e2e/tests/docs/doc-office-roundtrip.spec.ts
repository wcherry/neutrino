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
 * Requires the `officeInPlaceEditing` feature flag. Following the pattern
 * already used by e2e/tests/sheets/sheet-charts.spec.ts (which gates
 * `sheetsCharts` the same way), we intercept `/api/v1/feature-flags` and
 * merge the flag on, since no admin-toggle E2E precedent exists for this
 * flag yet.
 */

import { test, expect } from '../../fixtures/base';
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
}

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
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
}

test.describe('Docs — office round-trip editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/feature-flags', async route => {
      const response = await route.fetch();
      const flags = await response.json();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ...flags, officeInPlaceEditing: true }),
      });
    });
  });

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

    const download = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(download.ok()).toBeTruthy();
    const buffer = Buffer.from(await download.body());
    assertValidOoxmlZip(buffer);
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
