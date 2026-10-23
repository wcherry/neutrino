/**
 * The new shell, the command palette, and the organisation layer — UI roadmap stage 3
 * (agent_docs/ui-roadmap.md).
 *
 * **Administrators.** Branding, org defaults and locks are admin-only, and this suite registers
 * every account as an ordinary user (see `settings/feature-flags.spec.ts`). The admin check reads
 * the access token's `is_admin` claim, so the admin calls here use a token signed with the test
 * stack's own JWT secret (`secrets/jwt_secret.txt`, or `NEUTRINO_E2E_JWT_SECRET` for a stack that
 * takes its secret from the environment) for a real user — the server still checks everything else
 * it checks. The admin *page* reads the role from the database, which this suite cannot set, so it
 * is not driven here; its requests are these same routes.
 *
 * Everything an organisation sets applies to the whole instance, so each test that sets something
 * puts it back in a `finally` — the suite runs one test at a time, but the next one shares the
 * instance.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page, prefix: string): Promise<{ email: string; token: string; id: string }> {
  const email = uniqueEmail(prefix);
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Shell Test', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
  const token = (await page.evaluate(() => localStorage.getItem('access_token')))!;
  const me = await request.get(`${BASE_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  return { email, token, id: (await me.json()).id };
}

function jwtSecret(): string {
  if (process.env.NEUTRINO_E2E_JWT_SECRET) return process.env.NEUTRINO_E2E_JWT_SECRET;
  return fs.readFileSync(path.join(__dirname, '../../secrets/jwt_secret.txt'), 'utf8').trim();
}

/** An access token for `userId` with the admin claim, signed as the server signs its own. */
function adminToken(userId: string, email: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: userId, email, iat: now, exp: now + 900, is_admin: true });
  const sig = crypto.createHmac('sha256', jwtSecret()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function setOrg(request: APIRequestContext, admin: string, values: Record<string, unknown>): Promise<void> {
  const res = await request.patch(`${BASE_URL}/api/v1/admin/preferences`, {
    data: { values },
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `org preferences: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function setBranding(request: APIRequestContext, admin: string, brand: Record<string, unknown>): Promise<void> {
  const res = await request.put(`${BASE_URL}/api/v1/admin/branding`, {
    data: brand,
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `branding: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function chooseLook(page: Page, name: string): Promise<void> {
  await page.goto('/settings?tab=appearance');
  await page.getByRole('radio', { name: new RegExp(`^${name}`) }).click();
}

test.describe('The new shell', () => {
  test('a new look swaps the shell for one top bar with the encryption pill and Apps in the sidebar', async ({ page, request }) => {
    await registerAndLogin(request, page, 'shell_look');
    // Classic is the default: today's top bar, with its own search box.
    await expect(page.getByPlaceholder('Search in Drive...')).toBeVisible();
    await expect(page.getByText('End-to-end encrypted')).toHaveCount(0);

    await chooseLook(page, 'Quiet Precision');
    await expect(page.locator('html')).toHaveAttribute('data-look', 'precision');
    await page.goto('/drive');
    await expect(page.getByText('End-to-end encrypted')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search and commands' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(nav.getByRole('link', { name: 'Sheets' })).toBeVisible();

    // It sticks across a reload, applied before first paint.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-look', 'precision');
    await expect(page.getByText('End-to-end encrypted')).toBeVisible();
  });

  test('an editor gets the editor frame: no top bar, the sidebar keeps search and the account', async ({ page, request }) => {
    await registerAndLogin(request, page, 'shell_editor');
    await chooseLook(page, 'Light Flow');
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: 'Document' }).click();
    await expect(page).toHaveURL(/\/docs\/editor/, { timeout: 15_000 });
    await expect(page.getByText('End-to-end encrypted')).toHaveCount(0);
    const sidebar = page.getByRole('complementary', { name: 'Application navigation' });
    await expect(sidebar.getByRole('button', { name: 'Search and commands' })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Account' })).toBeVisible();
  });
});

test.describe('The command palette', () => {
  for (const look of ['Classic', 'Blended Flow']) {
    test(`⌘K runs a command — ${look}`, async ({ page, request }) => {
      await registerAndLogin(request, page, 'palette');
      if (look !== 'Classic') await chooseLook(page, look);
      await page.goto('/drive');
      await page.keyboard.press('ControlOrMeta+k');
      const palette = page.getByRole('dialog', { name: 'Search and commands' });
      await expect(palette).toBeVisible();
      await palette.getByRole('combobox').fill('go to sheets');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/sheets/);
      await expect(palette).toBeHidden();
    });
  }

  test('lists the commands of the screen underneath, and Escape closes only the palette', async ({ page, request }) => {
    await registerAndLogin(request, page, 'palette_scope');
    await page.goto('/drive');
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Search and commands' });
    await palette.getByRole('combobox').fill('keyboard');
    await expect(palette.getByRole('option', { name: /Open keyboard shortcuts/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(page).toHaveURL(/\/drive/);
  });
});

test.describe('The organisation', () => {
  test('a locked look applies to everyone, and Settings says who set it', async ({ page, request }) => {
    const user = await registerAndLogin(request, page, 'org_lock');
    const admin = adminToken(user.id, user.email);
    try {
      await setOrg(request, admin, { 'appearance.look': { value: 'precision', locked: true } });
      await page.goto('/settings?tab=appearance');
      await expect(page.locator('html')).toHaveAttribute('data-look', 'precision');
      await expect(page.getByText('Set by your organisation').first()).toBeVisible();
      await expect(page.getByRole('radio', { name: /^Light Flow/ })).toBeDisabled();

      // The server refuses the write too, not just the control.
      const res = await request.patch(`${BASE_URL}/api/v1/preferences`, {
        data: { values: { 'appearance.look': 'lightflow' } },
        headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      });
      expect(res.status()).toBe(403);

      // A device that has never loaded the app gets the locked look before first paint: the page
      // carries the org layer and the anti-FOUC script applies it.
      const fresh = await page.context().browser()!.newPage();
      await fresh.goto(`${BASE_URL}/sign-in`);
      await expect(fresh.locator('html')).toHaveAttribute('data-look', 'precision');
      await fresh.close();
    } finally {
      await setOrg(request, admin, { 'appearance.look': null });
    }
  });

  test('hiding an app takes it out of the sidebar and the New menu', async ({ page, request }) => {
    const user = await registerAndLogin(request, page, 'org_apps');
    const admin = adminToken(user.id, user.email);
    try {
      await setOrg(request, admin, { 'apps.enabled': { value: ['docs', 'sheets', 'slides', 'notes', 'calendar'], locked: true } });
      await page.goto('/drive');
      const nav = page.getByRole('navigation', { name: 'Primary navigation' });
      await expect(nav.getByRole('link', { name: 'Sheets' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Photos' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Diagrams' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Create new item' }).click();
      await expect(page.getByRole('menuitem', { name: 'Diagram' })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: 'Spreadsheet' })).toBeVisible();
      // Hiding is not blocking: a link into a hidden app still opens.
      await page.goto('/photos');
      await expect(page).toHaveURL(/\/photos/);
    } finally {
      await setOrg(request, admin, { 'apps.enabled': null });
    }
  });

  test('the brand is in the sign-in page itself, before any script runs', async ({ page, request }) => {
    const user = await registerAndLogin(request, page, 'org_brand');
    const admin = adminToken(user.id, user.email);
    try {
      await setBranding(request, admin, { name: 'Acme Cloud', accent: '#0e7a4a', signInMessage: 'Use your Acme email.' });
      const html = await (await request.get(`${BASE_URL}/sign-in/`)).text();
      expect(html).toMatch(/window\.__NEUTRINO_INSTANCE__=.*"name":"Acme Cloud"/);
      expect(html).toContain('--brand-accent:#0e7a4a');

      const signedOut = await page.context().browser()!.newPage();
      await signedOut.goto(`${BASE_URL}/sign-in`);
      await expect(signedOut.getByText('Acme Cloud')).toBeVisible();
      await expect(signedOut.getByText('Use your Acme email.')).toBeVisible();
      await signedOut.close();

      // An accent too light to read as text is refused, whatever the client allowed.
      const res = await request.put(`${BASE_URL}/api/v1/admin/branding`, {
        data: { accent: '#ffd400' },
        headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      });
      expect(res.status()).toBe(400);
    } finally {
      await setBranding(request, admin, {});
    }
  });
});
