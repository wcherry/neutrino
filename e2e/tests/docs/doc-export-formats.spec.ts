import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `docs_expfmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Export Formats Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function openNewDoc(page: Page): Promise<void> {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Document' }).click();
  await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
}

async function openExportMenu(
  page: Page,
  format: 'PDF (.pdf)' | 'Microsoft Word (.docx)' | 'Web page (.html)' | 'Plain text (.txt)',
): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('menu').getByText('File').hover();
  await page.getByText('Export as…').hover();
  await page.getByText(format).click();
  await expect(page.getByText('Save As')).toBeVisible({ timeout: 5_000 });
}

async function downloadViaDialog(page: Page, filename: string) {
  const filenameInput = page.getByLabel('Filename');
  await filenameInput.clear();
  await filenameInput.fill(filename);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Download' }).click(),
  ]);

  return download;
}

test.describe('Docs export formats — DOCX', () => {
  test('exporting as DOCX produces a non-empty .docx file', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('DOCX export test content.');

    await openExportMenu(page, 'Microsoft Word (.docx)');
    const download = await downloadViaDialog(page, 'test-docx');

    expect(download.suggestedFilename()).toMatch(/\.docx$/i);
    const path = await download.path();
    expect(path).toBeTruthy();

    // DOCX is a ZIP archive; the first two bytes are always 'PK' (0x50 0x4B)
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.length).toBeGreaterThan(1_000);

    await expect(page.getByText('Save As')).not.toBeVisible({ timeout: 5_000 });
  });

  test('DOCX export with headings produces a valid archive', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();

    // Heading 1
    await page.keyboard.press('Control+Alt+1');
    await editor.pressSequentially('Document Title');
    await page.keyboard.press('Enter');

    // Heading 2
    await page.keyboard.press('Control+Alt+2');
    await editor.pressSequentially('Section Heading');
    await page.keyboard.press('Enter');

    // Normal paragraph
    await page.keyboard.press('Control+Alt+0');
    await editor.pressSequentially('Body paragraph content.');

    await openExportMenu(page, 'Microsoft Word (.docx)');
    const download = await downloadViaDialog(page, 'headings-docx');

    expect(download.suggestedFilename()).toMatch(/\.docx$/i);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.length).toBeGreaterThan(2_000);
  });

  test('DOCX export with bold, italic, and underline preserves the archive format', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();

    await page.getByTitle('Bold (Ctrl+B)').click();
    await editor.pressSequentially('Bold ');
    await page.getByTitle('Bold (Ctrl+B)').click();

    await page.getByTitle('Italic (Ctrl+I)').click();
    await editor.pressSequentially('italic ');
    await page.getByTitle('Italic (Ctrl+I)').click();

    await page.getByTitle('Underline (Ctrl+U)').click();
    await editor.pressSequentially('underline');
    await page.getByTitle('Underline (Ctrl+U)').click();

    await expect(editor.locator('strong')).toBeVisible({ timeout: 3_000 });

    await openExportMenu(page, 'Microsoft Word (.docx)');
    const download = await downloadViaDialog(page, 'styled-docx');

    expect(download.suggestedFilename()).toMatch(/\.docx$/i);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.length).toBeGreaterThan(1_000);
  });

  test('DOCX export does not show Security options in the Save As dialog', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Security check content.');

    await openExportMenu(page, 'Microsoft Word (.docx)');
    await expect(page.getByText('Security options')).not.toBeVisible({ timeout: 2_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Save As')).not.toBeVisible({ timeout: 3_000 });
  });

  test('cancelling the DOCX Save As dialog does not trigger a download', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Cancel test content.');

    await openExportMenu(page, 'Microsoft Word (.docx)');

    let downloadFired = false;
    page.once('download', () => { downloadFired = true; });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Save As')).not.toBeVisible({ timeout: 3_000 });
    await page.waitForTimeout(500);
    expect(downloadFired).toBe(false);
  });
});

test.describe('Docs export formats — HTML', () => {
  test('exporting as HTML produces a .html file containing the document content', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('HTML export test content here.');

    await openExportMenu(page, 'Web page (.html)');
    const download = await downloadViaDialog(page, 'html-export');

    expect(download.suggestedFilename()).toMatch(/\.html$/i);
    const path = await download.path();
    expect(path).toBeTruthy();

    const { readFileSync } = await import('fs');
    const content = readFileSync(path!, 'utf-8');
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('HTML export test content here.');
    expect(content.length).toBeGreaterThan(100);

    await expect(page.getByText('Save As')).not.toBeVisible({ timeout: 5_000 });
  });

  test('HTML export contains headings when the document has them', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();

    await page.getByTitle('Paragraph style').selectOption('Heading 1');
    await editor.pressSequentially('My Report');
    await page.keyboard.press('Enter');
    await editor.pressSequentially('Introduction paragraph.');

    await openExportMenu(page, 'Web page (.html)');
    const download = await downloadViaDialog(page, 'headings-html');

    expect(download.suggestedFilename()).toMatch(/\.html$/i);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    const content = readFileSync(path!, 'utf-8');
    expect(content).toContain('<h1');
    expect(content).toContain('My Report');
  });

  test('HTML export does not show Security options in the Save As dialog', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Security check.');

    await openExportMenu(page, 'Web page (.html)');
    await expect(page.getByText('Security options')).not.toBeVisible({ timeout: 2_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('Docs export formats — Plain text', () => {
  test('exporting as plain text produces a non-empty .txt file', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Plain text export test content.');

    await openExportMenu(page, 'Plain text (.txt)');
    const download = await downloadViaDialog(page, 'txt-export');

    expect(download.suggestedFilename()).toMatch(/\.txt$/i);
    const path = await download.path();
    expect(path).toBeTruthy();

    const { statSync } = await import('fs');
    const stats = statSync(path!);
    expect(stats.size).toBeGreaterThan(0);

    await expect(page.getByText('Save As')).not.toBeVisible({ timeout: 5_000 });
  });

  test('plain text export does not show Security options', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Security check.');

    await openExportMenu(page, 'Plain text (.txt)');
    await expect(page.getByText('Security options')).not.toBeVisible({ timeout: 2_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});
