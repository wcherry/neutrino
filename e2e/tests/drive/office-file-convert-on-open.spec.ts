/**
 * E2E: "Convert on open" mode + manual "Convert to Neutrino Doc" action
 * (issue #43 — in-place editing of MS Office docs).
 *
 * Two independent flows:
 *  1. With the Settings "Drive" tab's office-file mode set to "Convert on
 *     open" (localStorage key `neutrino:drive:officeFileMode`, see the plan
 *     / useOfficeFileMode.ts), opening a fresh .docx file silently promotes
 *     it: the mime type flips to the native Neutrino doc type (observable via
 *     the file's Drive icon, and via the drive metadata endpoint), and a
 *     second open no longer re-runs the conversion (it behaves like any
 *     other native doc from then on).
 *  2. The manual "Convert to Neutrino Doc" context-menu action promotes a
 *     file as a one-shot action regardless of the global setting — verified
 *     here while the global setting is still the default "native-roundtrip".
 *
 * Judgment calls (no existing UI to confirm against, since the Settings
 * "Drive" tab / conversion menu action do not exist yet):
 *  - Settings tab is labelled "Drive" and reached via clickTab(page, 'Drive')
 *    (same tab-bar locator pattern as e2e/tests/settings/settings.spec.ts).
 *  - The mode control exposes two options with accessible names "Native
 *    round-trip" and "Convert on open" (segmented-button pattern, per the
 *    plan's reference to Calendar's "Start of week" control).
 *  - The context-menu one-shot action's accessible name is exactly
 *    "Convert to Neutrino Doc", per the plan's own wording.
 * If the eventual implementation uses different labels, only the selectors
 * below need updating — the flow/assertions describe the real contract.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:9880';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const NATIVE_DOC_MIME = 'application/x-neutrino-doc';
const FIXTURE_PATH = path.resolve(__dirname, '../../fixtures/sample.docx');

function uniqueEmail(): string {
  return `office_convert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Office Convert Test User', email, password },
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

async function uploadSampleDocx(request: APIRequestContext, token: string, filename: string): Promise<string> {
  const buffer = fs.readFileSync(FIXTURE_PATH);
  const res = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: filename, mimeType: DOCX_MIME, buffer },
    },
  });
  expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function getFileMimeType(request: APIRequestContext, token: string, fileId: string): Promise<string> {
  const res = await request.get(`${BASE_URL}/api/v1/drive/files/${fileId}/metadata`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `metadata fetch failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = (await res.json()) as { mimeType: string };
  return data.mimeType;
}

function clickSettingsTab(page: Page, label: string) {
  return page.locator('[class*="tabBar"]').getByRole('button', { name: label }).click();
}

test.describe('Drive — office file convert-on-open', () => {
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

  test('setting "Convert on open" then opening a fresh .docx silently promotes it', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileId = await uploadSampleDocx(request, token, 'convert-on-open.docx');

    // Before conversion: still a raw docx.
    expect(await getFileMimeType(request, token, fileId)).toBe(DOCX_MIME);

    await page.goto('/settings');
    await clickSettingsTab(page, 'Drive');
    await page.getByRole('button', { name: 'Convert on open' }).click();

    await page.goto('/drive');
    await page.getByRole('listitem', { name: 'convert-on-open.docx' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/docs/editor/?\\?id=${fileId}`), { timeout: 15_000 });

    // Promotion should have happened on this first open.
    await expect
      .poll(async () => getFileMimeType(request, token, fileId), { timeout: 15_000 })
      .toBe(NATIVE_DOC_MIME);

    // Subsequent opens are just a normal native doc — no office-mode
    // reconversion, and the Drive grid icon reflects the native doc type.
    await page.goto('/drive');
    const item = page.getByRole('listitem', { name: 'convert-on-open.docx' }).first();
    await expect(item).toBeVisible({ timeout: 10_000 });
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/docs/editor/?\\?id=${fileId}`), { timeout: 15_000 });
  });

  test('the manual "Convert to Neutrino Doc" action promotes a file as a one-shot regardless of the global setting', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileId = await uploadSampleDocx(request, token, 'manual-convert.docx');

    // Global setting is left at its default (native round-trip) — the
    // manual action must still work independently of it.
    expect(await getFileMimeType(request, token, fileId)).toBe(DOCX_MIME);

    await page.goto('/drive');
    await page.getByRole('listitem', { name: 'manual-convert.docx' }).first().hover();
    await page.getByLabel('More options for manual-convert.docx').click();
    await expect(page.getByRole('menu', { name: 'File options' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('menuitem', { name: 'Convert to Neutrino Doc' }).click();

    await expect
      .poll(async () => getFileMimeType(request, token, fileId), { timeout: 15_000 })
      .toBe(NATIVE_DOC_MIME);

    // Opening it now behaves like any other native doc.
    await page.goto('/drive');
    await page.getByRole('listitem', { name: 'manual-convert.docx' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/docs/editor/?\\?id=${fileId}`), { timeout: 15_000 });
  });
});
