/**
 * Adding markdown to a note without typing its syntax (issue #44): the
 * Ctrl/Cmd keyboard shortcuts, and the `/` menu's markdown blocks.
 *
 * A block stores markdown source and renders it when it leaves edit mode, so
 * each case is checked twice — the source in the textarea, then the element it
 * renders as once the block is no longer focused.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';
import { createNoteViaApi } from '../../fixtures/notes';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `notes_markdown_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Notes Markdown Test User', email, password },
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

/** Open a fresh note and put the caret in its first block. */
async function openNewNote(request: APIRequestContext, page: Page, title: string): Promise<void> {
  const noteId = await createNoteViaApi(request, page, title);
  await page.goto(`/notes/editor?id=${noteId}`);
  await expect(page.getByLabel('Note title')).toBeVisible({ timeout: 10_000 });
  await page.getByText('Start writing…', { exact: false }).locator('xpath=..').click();
  await expect(page.getByRole('textbox', { name: 'Block 1' })).toBeVisible({ timeout: 5_000 });
}

/** Move focus out of the block so it renders its markdown rather than the source. */
async function leaveEditMode(page: Page): Promise<void> {
  await page.getByLabel('Note title').click();
}

test.describe('Notes — markdown keyboard shortcuts', () => {
  test('Ctrl+B wraps the selected word, and the block renders it bold', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewNote(request, page, 'Markdown Shortcuts Test');

    const block1 = page.getByRole('textbox', { name: 'Block 1' });
    await block1.fill('one two');
    await block1.press('End');
    // Select just "two".
    for (let i = 0; i < 3; i++) await block1.press('Shift+ArrowLeft');
    await block1.press('ControlOrMeta+b');

    await expect(block1).toHaveValue('one **two**');
    await leaveEditMode(page);
    await expect(page.locator('[data-block-id] strong', { hasText: 'two' })).toBeVisible({ timeout: 5_000 });
  });

  test('Ctrl+Alt+1 makes a heading and Ctrl+Shift+8 a bullet', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewNote(request, page, 'Markdown Block Shortcuts Test');

    const block1 = page.getByRole('textbox', { name: 'Block 1' });
    await block1.fill('Section');
    await block1.press('End');
    await block1.press('ControlOrMeta+Alt+Digit1');
    await expect(block1).toHaveValue('# Section');

    await block1.press('Enter');
    const block2 = page.getByRole('textbox', { name: 'Block 2' });
    await block2.fill('an item');
    await block2.press('ControlOrMeta+Shift+Digit8');

    await leaveEditMode(page);
    await expect(page.locator('[data-block-id] h1', { hasText: 'Section' })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[class*="prefixBullet"]')).toHaveCount(1);
  });
});

test.describe('Notes — markdown blocks in the / menu', () => {
  test('/ inserts a heading and a divider', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewNote(request, page, 'Markdown Slash Menu Test');

    const block1 = page.getByRole('textbox', { name: 'Block 1' });
    await block1.pressSequentially('/h2');
    await expect(page.getByRole('option', { name: /Heading 2/ })).toBeVisible({ timeout: 5_000 });
    await block1.press('Enter');
    await expect(block1).toHaveValue('## ');
    // Typed straight after the command, with no pause: the caret has to already
    // be after the `## `, or the first characters land in front of it.
    await block1.pressSequentially('Subsection');
    await expect(block1).toHaveValue('## Subsection');
    await block1.press('End');
    await block1.press('Enter');

    const block2 = page.getByRole('textbox', { name: 'Block 2' });
    await block2.pressSequentially('/divider');
    await expect(page.getByRole('option', { name: /Divider/ })).toBeVisible({ timeout: 5_000 });
    await block2.press('Enter');
    await expect(block2).toHaveValue('---');

    await leaveEditMode(page);
    await expect(page.locator('[data-block-id] h2', { hasText: 'Subsection' })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-block-id] hr')).toBeVisible();
  });
});
