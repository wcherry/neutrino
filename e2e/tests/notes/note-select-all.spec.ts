import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `notes_selectall_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Notes Select-All Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function createNoteViaApi(
  request: APIRequestContext,
  page: Page,
  title: string,
): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  const res = await request.post(`${BASE_URL}/api/v1/notes`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title },
  });
  expect(res.ok(), `create note failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Fill the note's first two blocks, leaving the caret in block 2 — the state
 * a user is normally in right before pressing Ctrl+A: mid-edit, not blurred
 * out to the title field or anywhere else.
 */
async function fillTwoBlocksAndFocusSecond(
  page: Page,
  first: string,
  second: string,
): Promise<void> {
  await page.getByText('Start writing…', { exact: false }).locator('xpath=..').click();
  const block1 = page.getByRole('textbox', { name: 'Block 1' });
  await expect(block1).toBeVisible({ timeout: 5_000 });
  await block1.fill(first);
  await block1.press('End');
  await block1.press('Enter');

  const block2 = page.getByRole('textbox', { name: 'Block 2' });
  await expect(block2).toBeVisible({ timeout: 5_000 });
  await block2.fill(second);
  await block2.press('End');
}

function currentSelectionText(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

test.describe('Notes — Select all spans the whole note body', () => {
  // Regression coverage for: each block toggles between a read-only <div>
  // (view mode) and a <textarea> (edit mode, one block at a time). Select
  // all must not be scoped to whichever single block happens to be a
  // <textarea> right now — it needs the entire note.

  test('Ctrl+A while mid-edit selects every block, not just the focused one', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const noteId = await createNoteViaApi(request, page, 'Select All Keyboard Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await fillTwoBlocksAndFocusSecond(page, 'Alpha block content', 'Beta block content');

    // Focus is still in block 2's <textarea> — this is exactly the case that
    // used to select only "Beta block content".
    await page.keyboard.press('Control+a');

    const selected = await currentSelectionText(page);
    expect(selected).toContain('Alpha block content');
    expect(selected).toContain('Beta block content');
  });

  test('Edit > Select all (menu) selects every block', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const noteId = await createNoteViaApi(request, page, 'Select All Menu Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });

    await fillTwoBlocksAndFocusSecond(page, 'First paragraph', 'Second paragraph');

    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('menu').getByText('Edit').hover();
    await page.getByText('Select all').click();

    const selected = await currentSelectionText(page);
    expect(selected).toContain('First paragraph');
    expect(selected).toContain('Second paragraph');
  });

  test('Ctrl+A in the title field still selects only the title, not the note body', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const noteId = await createNoteViaApi(request, page, 'Select All Title Guard Test');

    await page.goto(`/notes/editor?id=${noteId}`);
    const titleInput = page.getByLabel('Note title');
    await expect(titleInput).toBeVisible({ timeout: 10_000 });

    await fillTwoBlocksAndFocusSecond(page, 'Body block one', 'Body block two');

    await titleInput.click();
    await page.keyboard.press('Control+a');

    // Native input select-all: the whole title string, selected inside the
    // <input>'s own selection — not a window Selection spanning the blocks.
    const selectedInTitle = await titleInput.evaluate((el: HTMLInputElement) =>
      el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)
    );
    expect(selectedInTitle).toBe('Select All Title Guard Test');

    const windowSelection = await currentSelectionText(page);
    expect(windowSelection).not.toContain('Body block one');
  });
});
