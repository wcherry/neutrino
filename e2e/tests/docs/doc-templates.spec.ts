/**
 * Docs templates (issue #128).
 *
 * A template is a `.dotx` in Drive. It is made with Export as → Word template,
 * listed by New from template, and copied into a new document in the browser
 * — the server never sees either body in the clear. The package's content type
 * is pinned by the unit tests (`ooxml/docxTemplate.test.ts`); what these cover
 * is the flow a user takes through it.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const DOTX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template';

function uniqueEmail(): string {
  return `docs_tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Templates Test User', email, password },
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

async function openNewDoc(page: Page): Promise<void> {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Document' }).click();
  await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
}

async function openExportAsTemplate(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('menu').getByText('File').hover();
  await page.getByText('Export as…').hover();
  await page.getByText('Word template (.dotx)').click();
  await expect(page.getByText('Save As')).toBeVisible({ timeout: 5_000 });
}

/** A document with `body` in it, saved to Drive as the template `name`. */
async function saveTemplateToDrive(page: Page, name: string, body: string): Promise<void> {
  await openNewDoc(page);
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await editor.pressSequentially(body);

  await openExportAsTemplate(page);
  const filename = page.getByLabel('Filename');
  await filename.clear();
  await filename.fill(name);
  await page.getByRole('button', { name: 'Neutrino Drive' }).click();
  await page.getByRole('button', { name: 'Save to Drive' }).click();
  await expect(page.getByText(/as a template/)).toBeVisible({ timeout: 15_000 });
}

async function listFiles(page: Page, mimeType: string): Promise<{ id: string; name: string }[]> {
  return page.evaluate(async ({ base, mime }) => {
    const token = localStorage.getItem('access_token');
    const res = await fetch(`${base}/api/v1/drive/files?mimeType=${encodeURIComponent(mime)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { files: { id: string; name: string }[] };
    return body.files;
  }, { base: BASE_URL, mime: mimeType });
}

test.describe('Docs templates', () => {
  test('a document exported as a template is stored in Drive as a .dotx', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await saveTemplateToDrive(page, 'Letterhead', 'Template body text');

    const templates = await listFiles(page, DOTX_MIME);
    expect(templates.map(t => t.name)).toEqual(['Letterhead.dotx']);
  });

  test('New from template creates a document holding the template content', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await saveTemplateToDrive(page, 'Weekly report', 'Status: on track');

    await page.goto('/docs');
    await page.getByRole('button', { name: 'New from template' }).click();
    await expect(page.getByRole('option', { name: 'Weekly report' })).toBeVisible({ timeout: 10_000 });

    const docName = page.getByLabel('Document name');
    await expect(docName).toHaveValue('Weekly report');
    await docName.fill('Report for week 40');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });
    await expect(page.locator('.ProseMirror')).toContainText('Status: on track', { timeout: 15_000 });
    await expect(page.locator('input[placeholder="Untitled document"]')).toHaveValue('Report for week 40');
    // A document, not a second template.
    await expect(page.getByText('Template', { exact: true })).not.toBeVisible();

    const docs = await listFiles(page, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(docs.map(d => d.name)).toContain('Report for week 40.docx');
  });

  test('a template opened from Drive is marked and can be used directly', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await saveTemplateToDrive(page, 'Invoice', 'Invoice number:');

    const [template] = await listFiles(page, DOTX_MIME);
    await page.goto(`/docs/editor?id=${template.id}`);
    await expect(page.locator('.ProseMirror')).toContainText('Invoice number:', { timeout: 15_000 });
    await expect(page.getByText('Template', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Use template' }).click();
    await expect(page).not.toHaveURL(new RegExp(`id=${template.id}`), { timeout: 15_000 });
    await expect(page.locator('.ProseMirror')).toContainText('Invoice number:', { timeout: 15_000 });

    // The template is still a template after being opened and used.
    const after = await listFiles(page, DOTX_MIME);
    expect(after.map(t => t.name)).toEqual(['Invoice.dotx']);
  });

  test('with no templates the picker says how to make one', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/docs');
    await page.getByRole('button', { name: 'New from template' }).click();
    await expect(page.getByTestId('doc-templates-empty')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  });
});
