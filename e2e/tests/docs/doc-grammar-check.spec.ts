/**
 * Grammar check E2E tests.
 *
 * Grammar check is part of the "editing tools" feature gap (#3) and requires
 * the docsEditingTools feature flag to be enabled:
 *   NEXT_PUBLIC_FEATURE_DOCS_EDITING_TOOLS=true
 *
 * All tests in this file are skipped automatically when that flag is off.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `docs_grammar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Grammar Check Test User', email, password },
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

/** Returns true when the grammar check toolbar button is present in the running app. */
async function isGrammarFeatureEnabled(page: Page): Promise<boolean> {
  try {
    await page.locator('[title="Enable grammar check"]').waitFor({ state: 'visible', timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('Docs grammar check', () => {
  test('grammar check toolbar button is visible when feature flag is enabled', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    if (!await isGrammarFeatureEnabled(page)) {
      test.skip(true, 'Skipped: NEXT_PUBLIC_FEATURE_DOCS_EDITING_TOOLS is not enabled');
      return;
    }

    await expect(page.locator('[title="Enable grammar check"]')).toBeVisible();
  });

  test('enabling grammar check via toolbar button decorates grammar errors', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    if (!await isGrammarFeatureEnabled(page)) {
      test.skip(true, 'Skipped: NEXT_PUBLIC_FEATURE_DOCS_EDITING_TOOLS is not enabled');
      return;
    }

    const editor = page.locator('.ProseMirror');
    await editor.click();
    // "a apple" triggers the article-before-vowel rule (a → an before vowel sounds)
    await editor.pressSequentially('I want a apple today');

    await page.locator('[title="Enable grammar check"]').click();

    // Grammar check rules are synchronous — decorations appear immediately
    await expect(editor.locator('.grammar-issue')).toBeVisible({ timeout: 5_000 });
  });

  test('disabling grammar check via toolbar button removes decorations', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    if (!await isGrammarFeatureEnabled(page)) {
      test.skip(true, 'Skipped: NEXT_PUBLIC_FEATURE_DOCS_EDITING_TOOLS is not enabled');
      return;
    }

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('I want a apple today');

    await page.locator('[title="Enable grammar check"]').click();
    await expect(editor.locator('.grammar-issue')).toBeVisible({ timeout: 5_000 });

    // Button title changes to reflect the active state
    await page.locator('[title="Grammar check on — click to disable"]').click();
    await expect(editor.locator('.grammar-issue')).toHaveCount(0, { timeout: 5_000 });
  });

  test('double-word errors are detected and decorated', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    if (!await isGrammarFeatureEnabled(page)) {
      test.skip(true, 'Skipped: NEXT_PUBLIC_FEATURE_DOCS_EDITING_TOOLS is not enabled');
      return;
    }

    const editor = page.locator('.ProseMirror');
    await editor.click();
    // Repeated "the the" triggers the double-word rule
    await editor.pressSequentially('I can see the the problem here');

    await page.locator('[title="Enable grammar check"]').click();

    await expect(editor.locator('.grammar-issue')).toBeVisible({ timeout: 5_000 });
  });

  test('its vs it\'s confusion is detected', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    if (!await isGrammarFeatureEnabled(page)) {
      test.skip(true, 'Skipped: NEXT_PUBLIC_FEATURE_DOCS_EDITING_TOOLS is not enabled');
      return;
    }

    const editor = page.locator('.ProseMirror');
    await editor.click();
    // "its a" (possessive used where contraction is needed) triggers the its/it's rule
    await editor.pressSequentially("its a great day outside");

    await page.locator('[title="Enable grammar check"]').click();

    await expect(editor.locator('.grammar-issue')).toBeVisible({ timeout: 5_000 });
  });

  test('right-clicking a grammar issue shows the error message in the context menu', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    if (!await isGrammarFeatureEnabled(page)) {
      test.skip(true, 'Skipped: NEXT_PUBLIC_FEATURE_DOCS_EDITING_TOOLS is not enabled');
      return;
    }

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('I want a apple');

    await page.locator('[title="Enable grammar check"]').click();

    const grammarIssue = editor.locator('.grammar-issue').first();
    await expect(grammarIssue).toBeVisible({ timeout: 5_000 });

    // Left-click to ensure empty selection, then right-click to open context menu
    await grammarIssue.click();
    await grammarIssue.click({ button: 'right' });

    const menu = page.getByRole('menu', { name: 'Editor options' });
    await expect(menu).toBeVisible({ timeout: 5_000 });

    // The grammar message (article-before-vowel) should appear at the top of the menu
    await expect(menu.getByText(/vowel/i)).toBeVisible({ timeout: 5_000 });
  });

  test('clicking the Fix button in the context menu applies the grammar correction', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    if (!await isGrammarFeatureEnabled(page)) {
      test.skip(true, 'Skipped: NEXT_PUBLIC_FEATURE_DOCS_EDITING_TOOLS is not enabled');
      return;
    }

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('I want a apple');

    await page.locator('[title="Enable grammar check"]').click();

    const grammarIssue = editor.locator('.grammar-issue').first();
    await expect(grammarIssue).toBeVisible({ timeout: 5_000 });

    await grammarIssue.click();
    await grammarIssue.click({ button: 'right' });

    const menu = page.getByRole('menu', { name: 'Editor options' });
    await expect(menu).toBeVisible({ timeout: 5_000 });

    // The Fix button label is: Fix: "suggestion"
    const fixButton = menu.getByRole('menuitem').filter({ hasText: /^Fix:/ });
    await expect(fixButton).toBeVisible({ timeout: 5_000 });
    await fixButton.click();

    // The grammar decoration should be gone and the text corrected ("a" → "an")
    await expect(editor.locator('.grammar-issue')).toHaveCount(0, { timeout: 5_000 });
    await expect(editor).toContainText('an apple', { timeout: 5_000 });
  });

  test('grammar check toggle in Edit menu enables grammar check', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openNewDoc(page);

    if (!await isGrammarFeatureEnabled(page)) {
      test.skip(true, 'Skipped: NEXT_PUBLIC_FEATURE_DOCS_EDITING_TOOLS is not enabled');
      return;
    }

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.pressSequentially('I want a apple today');

    // Open the hamburger menu (trigger has aria-label="Open menu")
    await page.getByRole('button', { name: 'Open menu' }).click();

    // The Edit submenu opens on hover
    const menuPanel = page.locator('[role="menu"]');
    await expect(menuPanel).toBeVisible({ timeout: 3_000 });
    await menuPanel.getByText('Edit', { exact: true }).hover();

    // Click "Grammar check" in the Edit submenu
    await menuPanel.getByRole('button', { name: 'Grammar check' }).click();

    // Grammar issues should now be visible
    await expect(editor.locator('.grammar-issue')).toBeVisible({ timeout: 5_000 });
  });
});
