/**
 * E2E: office-file routing dispatch across all three Drive entry points
 * (issue #43 — in-place editing of MS Office docs).
 *
 * Covers the `routeForFile` contract end-to-end: grid click, starred
 * quick-access, and the context-menu "Preview" action must all route a raw
 * .docx file into the Docs editor when `officeInPlaceEditing` is on (mirrors
 * the existing native-mimetype dispatch at drive/page.tsx's
 * handleGridItemClick / starred onClick / FileContextMenu.onPreview).
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:9880';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FIXTURE_PATH = path.resolve(__dirname, '../../fixtures/sample.docx');

function uniqueEmail(): string {
  return `office_routing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Office Routing Test User', email, password },
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

async function uploadSampleDocx(request: APIRequestContext, token: string, filename = 'sample.docx'): Promise<string> {
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

async function starFile(request: APIRequestContext, token: string, fileId: string): Promise<void> {
  const res = await request.patch(`${BASE_URL}/api/v1/drive/files/${fileId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { isStarred: true },
  });
  expect(res.ok(), `star failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe('Drive — office file routing', () => {
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

  test('clicking a .docx file in the grid opens the Docs editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileId = await uploadSampleDocx(request, token, 'grid-click.docx');

    await page.goto('/drive');
    await page.getByRole('listitem', { name: 'grid-click.docx' }).first().click();

    await expect(page).toHaveURL(new RegExp(`/docs/editor/?\\?id=${fileId}`), { timeout: 15_000 });
  });

  test('opening a .docx from starred quick-access opens the Docs editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileId = await uploadSampleDocx(request, token, 'starred.docx');
    await starFile(request, token, fileId);

    await page.goto('/drive');
    await page.getByRole('listitem', { name: 'starred.docx' }).first().click();

    await expect(page).toHaveURL(new RegExp(`/docs/editor/?\\?id=${fileId}`), { timeout: 15_000 });
  });

  test('the context-menu "Preview" action on a .docx file opens the Docs editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    const fileId = await uploadSampleDocx(request, token, 'context-menu.docx');

    await page.goto('/drive');
    await page.getByRole('listitem', { name: 'context-menu.docx' }).first().hover();
    await page.getByLabel('More options for context-menu.docx').click();
    await expect(page.getByRole('menu', { name: 'File options' })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('menuitem', { name: 'Preview' }).click();

    await expect(page).toHaveURL(new RegExp(`/docs/editor/?\\?id=${fileId}`), { timeout: 15_000 });
  });

  test('legacy .doc files are unaffected and still show the preview/download modal', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    // A .doc file is legacy binary Office format — officeAppForFile must
    // never match it, even with the flag on, so today's preview behavior
    // (not the Docs editor) must be preserved.
    const res = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        file: { name: 'legacy.doc', mimeType: 'application/msword', buffer: Buffer.from('legacy doc bytes') },
      },
    });
    expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    await page.goto('/drive');
    await page.getByRole('listitem', { name: 'legacy.doc' }).first().click();

    await expect(page).not.toHaveURL(/\/docs\/editor/, { timeout: 5_000 });
  });
});
