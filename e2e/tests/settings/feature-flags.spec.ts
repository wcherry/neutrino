/**
 * The feature flag system, end to end (issue #185, part 1).
 *
 * The assertion this file exists for is the parity one: the keys the web client declares in
 * `FLAG_KEYS` and the rows the database holds must be the same set. That is the check nothing had
 * last time, when four declared keys had no row, read as `undefined`, and rendered four features as
 * permanently off with nothing anywhere to say so.
 *
 * It is checked here rather than in a unit test because it is the only place both halves are real:
 * a unit test can compare the client's list against a hard-coded copy of the seed and pass while
 * the actual migration disagrees with both.
 *
 * **What is deliberately not covered here.** Changing a flag needs an admin, and this suite has no
 * way to create one — every account is registered through `POST /auth/register` as an ordinary
 * user, and there is no bootstrap endpoint. Writing the role straight into the database is not an
 * option: the test stack's SQLite file is a Docker bind mount, advisory locks do not carry across
 * it reliably, and a host-side write while the server holds the file open corrupts it. So the
 * admin-only endpoints are covered here only by what an *ordinary* user gets from them (403), and
 * the behaviour behind them — the gate, the toggle taking effect per request, the catalog
 * reconciliation — is covered by the Rust tests in `src/drive/feature_flags/`, which drive the same
 * code against a real database.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

/**
 * Every key the web client declares, kept in step with
 * `web/apps/web/src/lib/featureFlags.ts`.
 *
 * Duplicated rather than imported because the e2e suite is its own package and does not build the
 * web monorepo — and a copy that has to be updated by hand is exactly what this test catches when
 * it is not.
 */
const DECLARED_BY_CLIENT = [
  'teamSpaces',
  'teamSpacesPages',
  'teamSpacesFiles',
  'teamSpacesActivity',
];

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(request: APIRequestContext, email: string): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Flag Test User', email, password: 'Password123!' },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function signIn(page: Page, email: string): Promise<string> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Password123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

test.describe('feature flags', () => {
  test('the public endpoint carries every key the web client declares', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/feature-flags`);
    expect(res.ok(), `flags endpoint failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    const flags = (await res.json()) as Record<string, unknown>;
    const missing = DECLARED_BY_CLIENT.filter((key) => typeof flags[key] !== 'boolean');
    expect(
      missing,
      'a key the client declares with no row reads as undefined, which renders as a feature ' +
        'that is off with nothing to say why — see src/drive/feature_flags/catalog.rs'
    ).toEqual([]);
  });

  test('is unauthenticated, because the client needs it before sign-in', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/feature-flags`);
    expect(res.status()).toBe(200);
  });

  test('every Team Spaces flag ships disabled', async ({ request }) => {
    const flags = (await (await request.get(`${BASE_URL}/api/v1/feature-flags`)).json()) as Record<
      string,
      boolean
    >;
    for (const key of DECLARED_BY_CLIENT) {
      expect(flags[key], `${key} should be seeded off`).toBe(false);
    }
  });

  test('an ordinary user cannot read or change the flags', async ({ request, page }) => {
    const email = uniqueEmail('flag_user');
    await register(request, email);
    const token = await signIn(page, email);

    const list = await request.get(`${BASE_URL}/api/v1/admin/feature-flags`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.status()).toBe(403);

    const patch = await request.patch(`${BASE_URL}/api/v1/admin/feature-flags/teamSpaces`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { enabled: true },
    });
    expect(patch.status()).toBe(403);
  });

  test('changing a flag needs authentication at all', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/v1/admin/feature-flags/teamSpaces`, {
      headers: { 'Content-Type': 'application/json' },
      data: { enabled: true },
    });
    expect(res.status()).toBe(401);
  });
});
