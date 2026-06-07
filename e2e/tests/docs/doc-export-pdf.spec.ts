import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `docs_export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Export Test User', email, password },
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

/** Open hamburger → File → Export as… → chosen format */
async function openExportMenu(page: Page, format: 'PDF (.pdf)' | 'Microsoft Word (.docx)' | 'Web page (.html)' | 'Plain text (.txt)'): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 });

  await page.getByRole('menu').getByText('File').hover();
  await page.getByText('Export as…').hover();
  await page.getByText(format).click();

  // SaveAs dialog should appear
  await expect(page.getByText('Save As')).toBeVisible({ timeout: 5_000 });
}

/** Trigger local download and return the Playwright Download object */
async function downloadViaDialog(page: Page, filename: string) {
  const filenameInput = page.getByLabel('Filename');
  await filenameInput.clear();
  await filenameInput.fill(filename);

  // "This Device" tab is active by default
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Download' }).click(),
  ]);

  return download;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Docs PDF export', () => {

  test('exporting a plain-text document produces a non-empty PDF download', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Hello world. This is a plain text export test.');

    await openExportMenu(page, 'PDF (.pdf)');
    const download = await downloadViaDialog(page, 'plain-export');

    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    const path = await download.path();
    expect(path).toBeTruthy();

    // pdfmake always writes the PDF header as the first 5 bytes
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);
    expect(bytes.slice(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1_000);

    // Dialog should close after download
    await expect(page.getByText('Save As')).not.toBeVisible({ timeout: 5_000 });
  });

  test('exporting a document with headings produces a valid PDF', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();

    // Type a heading via Ctrl+Alt+1 then body text
    await page.keyboard.press('Control+Alt+1');
    await editor.pressSequentially('Main Heading');
    await page.keyboard.press('Enter');

    await page.keyboard.press('Control+Alt+2');
    await editor.pressSequentially('Subheading');
    await page.keyboard.press('Enter');

    // Back to normal paragraph
    await page.keyboard.press('Control+Alt+0');
    await editor.pressSequentially('This paragraph follows the subheading and contains body text.');

    await openExportMenu(page, 'PDF (.pdf)');
    const download = await downloadViaDialog(page, 'headings-export');

    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);
    expect(bytes.slice(0, 5).toString()).toBe('%PDF-');
    // A document with headings should produce a larger PDF than a minimal stub
    expect(bytes.length).toBeGreaterThan(5_000);
  });

  test('exporting a document with bold, italic and underline produces a valid PDF', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();

    // Bold text
    await page.keyboard.press('Control+b');
    await editor.pressSequentially('Bold text ');
    await page.keyboard.press('Control+b');

    // Italic text
    await page.keyboard.press('Control+i');
    await editor.pressSequentially('italic text ');
    await page.keyboard.press('Control+i');

    // Underlined text
    await page.keyboard.press('Control+u');
    await editor.pressSequentially('underlined text');
    await page.keyboard.press('Control+u');

    // Verify all marks are applied before exporting
    await expect(editor.locator('strong')).toBeVisible({ timeout: 3_000 });
    await expect(editor.locator('em')).toBeVisible({ timeout: 3_000 });
    await expect(editor.locator('u')).toBeVisible({ timeout: 3_000 });

    await openExportMenu(page, 'PDF (.pdf)');
    const download = await downloadViaDialog(page, 'styles-export');

    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);
    expect(bytes.slice(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(5_000);
  });

  test('exporting a document with colored text produces a valid PDF', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('This text will have colors applied.');

    // Select all text then apply a color via the text-color toolbar button
    await page.keyboard.press('Control+a');

    // Open the text-color picker
    const colorBtn = page.getByTitle('Text color');
    await colorBtn.click();

    // Swatch buttons have title="#RRGGBB" — wait for the palette to render then pick one
    const swatch = page.locator('[data-color-picker-portal] button[title^="#"]').first();
    await expect(swatch).toBeVisible({ timeout: 5_000 });
    await swatch.click();

    // Confirm color was applied — the editor content should have a span with a style color
    await expect(editor.locator('[style*="color"]')).toBeVisible({ timeout: 3_000 });

    await openExportMenu(page, 'PDF (.pdf)');
    const download = await downloadViaDialog(page, 'color-export');

    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);
    expect(bytes.slice(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(5_000);
  });

  test('exporting a document with mixed styles and colors produces a valid PDF', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();

    // Heading 1
    await page.keyboard.press('Control+Alt+1');
    await editor.pressSequentially('Document Title');
    await page.keyboard.press('Enter');

    // Normal paragraph with bold + italic mixed
    await page.keyboard.press('Control+Alt+0');
    await editor.pressSequentially('Normal text, ');
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Control+i');
    await editor.pressSequentially('bold and italic');
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Control+i');
    await editor.pressSequentially(', back to normal.');
    await page.keyboard.press('Enter');

    // Heading 2
    await page.keyboard.press('Control+Alt+2');
    await editor.pressSequentially('Section One');
    await page.keyboard.press('Enter');

    // Paragraph with color applied to a selection
    await page.keyboard.press('Control+Alt+0');
    await editor.pressSequentially('Select this part for color.');
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End'); // select the line

    const colorBtn = page.getByTitle('Text color');
    await colorBtn.click();

    // Pick the second swatch (a different color from the first test)
    const swatches = page.locator('[data-color-picker-portal] button[title^="#"]');
    await expect(swatches.first()).toBeVisible({ timeout: 5_000 });
    await swatches.nth(1).click();
    await page.keyboard.press('End'); // deselect

    await openExportMenu(page, 'PDF (.pdf)');
    const download = await downloadViaDialog(page, 'mixed-styles-export');

    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);
    expect(bytes.slice(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(5_000);
  });

  test('the SaveAs dialog shows Security options for PDF only', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Content for security options test.');

    await openExportMenu(page, 'PDF (.pdf)');

    // Security section toggle should be visible for PDF
    await expect(page.getByText('Security options')).toBeVisible({ timeout: 3_000 });

    // Close and verify docx export does NOT show security options
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Save As')).not.toBeVisible({ timeout: 3_000 });

    await openExportMenu(page, 'Microsoft Word (.docx)');
    await expect(page.getByText('Security options')).not.toBeVisible({ timeout: 2_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('PDF export with a password closes the dialog after download', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Confidential content for password-protected export.');

    await openExportMenu(page, 'PDF (.pdf)');

    // Expand security section and set a password
    await page.getByText('Security options').click();
    await page.getByLabel('Open password').fill('secret123');
    await page.getByLabel('Confirm password').fill('secret123');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    const path = await download.path();
    const { readFileSync } = await import('fs');
    const bytes = readFileSync(path!);
    expect(bytes.slice(0, 5).toString()).toBe('%PDF-');

    // Dialog must close on success
    await expect(page.getByText('Save As')).not.toBeVisible({ timeout: 5_000 });
  });

  test('PDF export shows an error when passwords do not match', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Test for mismatched passwords.');

    await openExportMenu(page, 'PDF (.pdf)');

    await page.getByText('Security options').click();
    await page.getByLabel('Open password').fill('secret123');
    await page.getByLabel('Confirm password').fill('different456');

    await page.getByRole('button', { name: 'Download' }).click();

    await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 3_000 });
    // Dialog must remain open
    await expect(page.getByText('Save As')).toBeVisible();
  });

  test('cancelling the SaveAs dialog does not trigger a download', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('Cancel export test content.');

    await openExportMenu(page, 'PDF (.pdf)');
    await expect(page.getByText('Save As')).toBeVisible({ timeout: 3_000 });

    let downloadFired = false;
    page.once('download', () => { downloadFired = true; });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Save As')).not.toBeVisible({ timeout: 3_000 });

    // Brief wait to confirm no download event was emitted
    await page.waitForTimeout(500);
    expect(downloadFired).toBe(false);
  });
});
