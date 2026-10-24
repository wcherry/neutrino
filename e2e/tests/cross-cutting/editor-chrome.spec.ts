/**
 * The editors in the new looks and their customizable toolbars — UI roadmap stage 5
 * (agent_docs/ui-roadmap.md): the shared editor frame (LF5) and toolbar pin/hide/reorder (U10).
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';

async function registerAndLogin(request: APIRequestContext, page: Page, prefix: string): Promise<string> {
  const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Editor Chrome Test', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
  return (await page.evaluate(() => localStorage.getItem('access_token')))!;
}

async function setPrefs(request: APIRequestContext, token: string, values: Record<string, unknown>): Promise<void> {
  const res = await request.patch(`${BASE_URL}/api/v1/preferences`, {
    data: { values },
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `preferences: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function openNew(page: Page, item: 'Document' | 'Spreadsheet'): Promise<void> {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: item }).click();
  if (item === 'Document') {
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(page.locator('[data-type="cell"][id="A1"]')).toBeVisible({ timeout: 15_000 });
  }
}

async function setCell(page: Page, ref: string, value: string): Promise<void> {
  await page.locator(`[data-type="cell"][id="${ref}"]`).click();
  const input = page.getByTestId('formula-bar-input');
  await input.fill(value);
  await input.press('Enter');
}

test.describe('Toolbar customization', () => {
  test('a tool hidden from the toolbar waits in More tools, and comes back on Reset', async ({ page, request }) => {
    await registerAndLogin(request, page, 'toolbar_hide');
    await openNew(page, 'Document');
    const textCase = page.getByTitle('Text case');
    await expect(textCase).toBeVisible();
    await expect(page.getByRole('button', { name: 'More tools' })).toHaveCount(0);

    await page.getByTitle('Bold (Ctrl+B)').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Customize toolbar…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Customize the Docs toolbar' });
    // The box is drawn over a hidden input, so it is ticked the way a person does: by its label.
    await dialog.getByText('Text case', { exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: 'Text case' })).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(textCase).toHaveCount(0);

    await page.getByRole('button', { name: 'More tools' }).click();
    await expect(page.getByRole('group', { name: 'More tools' }).getByTitle('Text case')).toBeVisible();

    // It follows the user: still hidden after a reload.
    await page.reload();
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTitle('Text case')).toHaveCount(0);

    // Anywhere on the bar, not only on a tool: here its empty right-hand end.
    const bar = page.locator('[data-tool="history"]').locator('xpath=../..');
    const box = (await bar.boundingBox())!;
    await bar.click({ button: 'right', position: { x: box.width - 4, y: box.height / 2 } });
    await page.getByRole('menuitem', { name: 'Customize toolbar…' }).click();
    await page.getByRole('button', { name: 'Reset to default' }).click();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByTitle('Text case')).toBeVisible();
  });

  test('tools reorder, and labels name each group', async ({ page, request }) => {
    const token = await registerAndLogin(request, page, 'toolbar_order');
    await setPrefs(request, token, {
      'editor.toolbars': { docs: { order: ['tools', 'history'], labels: true } },
    });
    await openNew(page, 'Document');
    const tools = page.locator('[data-tool]');
    await expect(tools.first()).toHaveAttribute('data-tool', 'tools');
    await expect(tools.nth(1)).toHaveAttribute('data-tool', 'history');
    await expect(page.locator('[data-tool="history"]').getByText('History')).toBeVisible();
  });

  test('Settings › Appearance › Toolbars changes an editor without opening it', async ({ page, request }) => {
    await registerAndLogin(request, page, 'toolbar_settings');
    await page.goto('/settings?tab=appearance');
    await page.getByRole('tab', { name: 'Sheets' }).click();
    const panel = page.getByRole('tabpanel', { name: 'Sheets toolbar' });
    await panel.getByText('Merge cells', { exact: true }).click();
    await expect(panel.getByRole('checkbox', { name: 'Merge cells' })).not.toBeChecked();
    await openNew(page, 'Spreadsheet');
    await expect(page.getByTitle('Merge Cells')).toHaveCount(0);
    await expect(page.getByTitle('Format Painter')).toBeVisible();
  });
});

test.describe('The editors in the new looks', () => {
  test('Customize toolbar… opens at the pointer, drawn on the page rather than in the toolbar', async ({ page, request }) => {
    const token = await registerAndLogin(request, page, 'chrome_menu');
    await setPrefs(request, token, { 'appearance.look': 'blended' });
    await openNew(page, 'Document');
    const bar = page.locator('[data-tool="history"]').locator('xpath=../..');
    const box = (await bar.boundingBox())!;
    const at = { x: box.width - 4, y: box.height / 2 };
    await bar.click({ button: 'right', position: at });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    // Inside a toolbar with a backdrop-filter (Blended's toolbar had one), a fixed menu was placed
    // against the toolbar rather than the window — far below and to the side of the pointer.
    const m = (await menu.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(m.x + m.width).toBeLessThanOrEqual(viewport.width);
    expect(Math.abs(m.y - (box.y + at.y))).toBeLessThan(8);
    expect(Math.abs(m.x + m.width - (box.x + at.x))).toBeLessThan(m.width + 8);
    // On <body>, no filter on a toolbar can move it, and its own glass blurs the page.
    expect(await menu.evaluate(el => el.parentElement === document.body)).toBe(true);
  });

  test('the title bar says the document is saved encrypted, and classic keeps its own wording', async ({ page, request }) => {
    const token = await registerAndLogin(request, page, 'chrome_save');
    await setPrefs(request, token, { 'appearance.look': 'precision' });
    await openNew(page, 'Document');
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('Hello');
    await expect(page.getByRole('status').filter({ hasText: 'Saved and encrypted' })).toBeVisible({ timeout: 15_000 });

    await setPrefs(request, token, { 'appearance.look': 'classic' });
    await page.reload();
    await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Saved and encrypted')).toHaveCount(0);
  });

  test('a sheet shows the running Sum of the selection beside its tabs', async ({ page, request }) => {
    const token = await registerAndLogin(request, page, 'chrome_sum');
    await setPrefs(request, token, { 'appearance.look': 'lightflow' });
    await openNew(page, 'Spreadsheet');
    await setCell(page, 'A1', '2');
    await setCell(page, 'A2', '5');
    await page.locator('[data-type="cell"][id="A1"]').click();
    await page.locator('[data-type="cell"][id="A2"]').click({ modifiers: ['Shift'] });
    await expect(page.getByText('Sum').locator('strong')).toHaveText('7');
    await expect(page.getByRole('status').filter({ hasText: 'Saved and encrypted' })).toBeVisible({ timeout: 15_000 });
  });
});
