import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';
import { createNoteViaApi } from '../../fixtures/notes';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `notes_dragselect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Notes Drag Select Test User', email, password },
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

test.describe('Notes — dragging to select rendered (view-mode) text', () => {
  // Regression coverage for a block editor bug where you could not select
  // text with the mouse at all: every block row was `draggable="true"` (for
  // reordering), so a mousedown-drag over its text started a native element
  // drag instead of a text selection; and even once that was fixed, the
  // click that fires on mouseup after a drag would immediately swap the row
  // into edit mode, collapsing whatever selection had just been made. Ctrl+C
  // had nothing left to copy either way.

  test('a mouse drag over view-mode text creates a real, persistent selection', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const noteId = await createNoteViaApi(request, page, 'Drag Select Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    const titleInput = page.getByLabel('Note title');
    await expect(titleInput).toBeVisible({ timeout: 10_000 });

    await page.getByText('Start writing…', { exact: false }).locator('xpath=..').click();
    const block1 = page.getByRole('textbox', { name: 'Block 1' });
    await expect(block1).toBeVisible({ timeout: 5_000 });
    await block1.fill('Some longer sentence to drag a selection across');

    // Blur back to view mode — dragging over an active <textarea> isn't the
    // bug (native textareas handle their own selection fine); the bug was
    // specifically about dragging over the *rendered* (non-editing) text.
    await titleInput.click();
    await expect(block1).not.toBeVisible({ timeout: 5_000 });

    const textEl = page.getByText('Some longer sentence to drag a selection across');
    const box = await textEl.boundingBox();
    if (!box) throw new Error('rendered block text has no bounding box');

    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(150, box.width - 5), box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(selected.length).toBeGreaterThan(0);
    expect('Some longer sentence to drag a selection across').toContain(selected);

    // The mouseup's click must not have swapped the block back into edit
    // mode — that would prove the selection just got collapsed away.
    await expect(page.getByRole('textbox', { name: 'Block 1' })).not.toBeVisible();
  });

  test('Ctrl+C after a drag-select, then Ctrl+V elsewhere, pastes the selected text', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const noteId = await createNoteViaApi(request, page, 'Drag Select Copy Paste Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    const titleInput = page.getByLabel('Note title');
    await expect(titleInput).toBeVisible({ timeout: 10_000 });

    await page.getByText('Start writing…', { exact: false }).locator('xpath=..').click();
    const block1 = page.getByRole('textbox', { name: 'Block 1' });
    await expect(block1).toBeVisible({ timeout: 5_000 });
    await block1.fill('CopyMe exact phrase here');
    await titleInput.click();
    await expect(block1).not.toBeVisible({ timeout: 5_000 });

    const textEl = page.getByText('CopyMe exact phrase here');
    const box = await textEl.boundingBox();
    if (!box) throw new Error('rendered block text has no bounding box');

    // Drag-select the whole line rather than a fixed number of pixels into it:
    // where 55px lands depends on the font the machine running this renders
    // with, and one machine's "CopyMe" is another's "CopyM" — a selection the
    // assertion below does not match.
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForTimeout(200);

    // Paste into the title field rather than reading the OS clipboard —
    // Ctrl+C/Ctrl+V within the same page is the reliable way to verify a
    // copy under browser automation (matches this repo's existing
    // sheet-absolute-refs.spec.ts pattern); navigator.clipboard.readText()
    // is not dependable under automation even when the copy itself worked.
    await titleInput.click();
    await titleInput.selectText();
    await page.keyboard.press('ControlOrMeta+v');

    await expect(titleInput).toHaveValue(/CopyMe/, { timeout: 5_000 });
  });
});
