import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
  prefix = 'dup',
): Promise<{ email: string; password: string }> {
  const email = uniqueEmail(prefix);
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  return { email, password };
}

async function gotoAppearance(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.locator('[class*="tabBar"]').getByRole('button', { name: 'Appearance' }).click();
  await expect(
    page.getByRole('heading', { name: 'Appearance', level: 2 }),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * ThemeGrid's card wrapper is a `role="button"` div whose accessible name is
 * polluted by the nested kebab-menu button's own `aria-label` — e.g. the
 * "Dark" card's computed name is "Dark More options for Dark", not just
 * "Dark". This affects every card locator in this file (both built-in
 * presets and custom themes, since custom cards use the same
 * `title={t.name}` + nested `aria-label="More options for {t.name}"`
 * structure). Matching the full polluted name is unambiguous since no two
 * cards ever produce colliding full strings.
 */
function cardName(name: string): string {
  return `${name} More options for ${name}`;
}

/** Hover the named theme card and open its kebab context menu. */
async function openThemeMenu(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: cardName(name) }).hover();
  await page.getByLabel(`More options for ${name}`).click();
  await expect(page.getByRole('menu', { name: 'Theme options' })).toBeVisible({ timeout: 5_000 });
}

/** Open the kebab menu for the named theme and click Duplicate. */
async function duplicateTheme(page: Page, name: string): Promise<void> {
  await openThemeMenu(page, name);
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
}

/** Assert ThemeEditorModal is open in edit mode with the given Name value, returning its dialog locator. */
async function expectEditorOpenWithName(page: Page, expectedName: string) {
  const dialog = page.getByRole('dialog', { name: 'Edit theme' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(dialog.getByLabel('Name')).toHaveValue(expectedName);
  return dialog;
}

/** Close the (edit-mode) ThemeEditorModal via Cancel. */
async function closeEditor(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Edit theme' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
}

/**
 * Create a new private (or public) custom theme via the "Create custom
 * theme" card + editor modal, and wait for the modal to close on save.
 *
 * The "Make this theme visible to everyone" checkbox can report as outside
 * the viewport / not stable to a plain `.click()` in this environment, so we
 * scroll it into view and dispatch the click event directly instead.
 */
async function createCustomTheme(
  page: Page,
  name: string,
  opts: { makePublic?: boolean } = {},
): Promise<void> {
  await page.getByRole('button', { name: 'Create custom theme' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create custom theme' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.getByLabel('Name').fill(name);
  if (opts.makePublic) {
    const toggle = dialog.getByLabel('Make this theme visible to everyone');
    await toggle.scrollIntoViewIfNeeded();
    await toggle.dispatchEvent('click');
  }
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
}

test.describe('Theme duplication', () => {
  test('duplicating a built-in preset creates a new custom theme and opens the editor on it', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'dup_preset');
    await gotoAppearance(page);

    await duplicateTheme(page, 'Dark');

    await expectEditorOpenWithName(page, 'Dark copy');
    await closeEditor(page);

    await expect(page.getByRole('button', { name: cardName('Dark copy') })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('duplicating your own private custom theme creates a copy and opens the editor on it', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'dup_own');
    await gotoAppearance(page);

    const themeName = `My Theme ${Date.now()}`;
    await createCustomTheme(page, themeName);
    await expect(page.getByRole('button', { name: cardName(themeName) })).toBeVisible({
      timeout: 10_000,
    });

    await duplicateTheme(page, themeName);

    const copyName = `${themeName} copy`;
    await expectEditorOpenWithName(page, copyName);
    await closeEditor(page);

    await expect(page.getByRole('button', { name: cardName(copyName) })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("a second user sees Duplicate-only options on another user's public theme and can duplicate it", async ({
    page,
    request,
    browser,
  }) => {
    await registerAndLogin(request, page, 'dup_owner');
    await gotoAppearance(page);

    const themeName = `Public Theme ${Date.now()}`;
    await createCustomTheme(page, themeName, { makePublic: true });
    await expect(page.getByRole('button', { name: cardName(themeName) })).toBeVisible({
      timeout: 10_000,
    });

    const context2 = await browser.newContext();
    try {
      const page2 = await context2.newPage();
      await registerAndLogin(request, page2, 'dup_other');
      await gotoAppearance(page2);

      const theirCard = page2.getByRole('button', { name: cardName(themeName) });
      await expect(theirCard).toBeVisible({ timeout: 10_000 });

      await openThemeMenu(page2, themeName);
      const menu = page2.getByRole('menu', { name: 'Theme options' });

      // Non-owner: only Duplicate is offered, no Delete or Make public.
      await expect(menu.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: 'Make public' })).toHaveCount(0);

      await menu.getByRole('menuitem', { name: 'Duplicate' }).click();

      const copyName = `${themeName} copy`;
      await expectEditorOpenWithName(page2, copyName);
      await closeEditor(page2);

      await expect(page2.getByRole('button', { name: cardName(copyName) })).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await context2.close();
    }
  });

  test('a duplicated theme can be deleted independently, leaving the original unaffected', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'dup_delete');
    await gotoAppearance(page);

    const themeName = `Delete Source ${Date.now()}`;
    await createCustomTheme(page, themeName);
    await expect(page.getByRole('button', { name: cardName(themeName) })).toBeVisible({
      timeout: 10_000,
    });

    await duplicateTheme(page, themeName);
    const copyName = `${themeName} copy`;
    await expectEditorOpenWithName(page, copyName);
    await closeEditor(page);
    await expect(page.getByRole('button', { name: cardName(copyName) })).toBeVisible({
      timeout: 10_000,
    });

    // Delete the copy via its own kebab menu.
    await openThemeMenu(page, copyName);
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible({ timeout: 5_000 });
    await confirmDialog.getByRole('button', { name: 'Delete' }).click();
    await expect(confirmDialog).not.toBeVisible({ timeout: 5_000 });

    // The copy is gone...
    await expect(page.getByRole('button', { name: cardName(copyName) })).not.toBeVisible({
      timeout: 10_000,
    });

    // ...but the original custom theme is still present, unaffected.
    await expect(page.getByRole('button', { name: cardName(themeName) })).toBeVisible();
  });
});
