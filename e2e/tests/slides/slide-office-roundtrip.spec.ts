/**
 * E2E: native round-trip editing of a raw .pptx file (issue #43 — in-place
 * editing of MS Office docs). Mirrors docs/doc-office-roundtrip.spec.ts.
 *
 * Uploads e2e/fixtures/sample.pptx, opens it (must land in the Slides
 * editor, not the preview modal), edits the title text, reloads to confirm
 * the edit persisted, then downloads the raw file and sanity-checks it is
 * still a structurally valid OOXML zip.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:9880';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const FIXTURE_PATH = path.resolve(__dirname, '../../fixtures/sample.pptx');

function uniqueEmail(): string {
  return `slides_office_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Slides Office Test User', email, password },
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

async function uploadSamplePptx(request: APIRequestContext, token: string): Promise<string> {
  const buffer = fs.readFileSync(FIXTURE_PATH);
  const res = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: 'sample.pptx', mimeType: PPTX_MIME, buffer },
    },
  });
  expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = (await res.json()) as { id: string };
  return data.id;
}

function assertValidOoxmlZip(buffer: Buffer) {
  const zipMagic = buffer.subarray(0, 4).toString('latin1');
  expect(['PK\x03\x04', 'PK\x05\x06']).toContain(zipMagic);
  expect(buffer.includes(Buffer.from('[Content_Types].xml'))).toBeTruthy();
  expect(buffer.includes(Buffer.from('ppt/presentation.xml'))).toBeTruthy();
}

test.describe('Slides — office round-trip editing', () => {
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

  test('opening a raw .pptx lands in the Slides editor, not the preview modal', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileId = await uploadSamplePptx(request, token);

    await page.goto('/drive');
    await page.getByRole('listitem', { name: 'sample.pptx' }).first().click();

    await expect(page).toHaveURL(new RegExp(`/slides/editor/?\\?id=${fileId}`), { timeout: 15_000 });
    await expect(page.getByText('preview not available', { exact: false })).not.toBeVisible();
    await expect(page.locator('text=Neutrino office round-trip fixture').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('editing the title, reloading, and downloading preserves the edit as valid OOXML', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileId = await uploadSamplePptx(request, token);

    await page.goto(`/slides/editor?id=${fileId}`);
    // The same title text also appears in the (non-interactive) slide-panel
    // thumbnail, which renders before the editable canvas in the DOM — scope
    // to the canvas so the double-click actually starts text editing.
    const titleEl = page.locator('[class*="slideCanvas"]').getByText('Neutrino office round-trip fixture').first();
    await expect(titleEl).toBeVisible({ timeout: 10_000 });

    await titleEl.dblclick();
    await page.keyboard.press('End');
    await page.keyboard.type(' (edited)');
    await page.keyboard.press('Escape');

    await page.waitForTimeout(4_000);
    await page.reload();

    // The edited title renders both in the canvas and the slide-panel thumbnail.
    await expect(page.getByText('(edited)', { exact: false }).first()).toBeVisible({ timeout: 15_000 });

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
    const fileId = await uploadSamplePptx(request, token);

    await page.goto(`/slides/editor?id=${fileId}`);
    const titleEl = page.locator('[class*="slideCanvas"]').getByText('Neutrino office round-trip fixture').first();
    await expect(titleEl).toBeVisible({ timeout: 10_000 });
    await titleEl.dblclick();
    await page.keyboard.type(' more');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(4_000);

    const metaRes = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/metadata`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(metaRes.ok()).toBeTruthy();
    const meta = (await metaRes.json()) as { id: string; name: string; mimeType: string };
    expect(meta.id).toBe(fileId);
    expect(meta.name).toBe('sample.pptx');
    expect(meta.mimeType).toBe(PPTX_MIME);
  });
});
