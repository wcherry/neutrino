/**
 * Team Spaces end to end (issue #185).
 *
 * This file covers the **flag-off** half, and that half matters as much as the other: with
 * `teamSpaces` disabled the application has to be exactly what it was before this release — the
 * sidebar still says Shared Drives, and every team route answers 404 rather than 403. A flag whose
 * off state has never been exercised is not a kill switch, and off is the state every existing
 * deployment is in the day this ships.
 *
 * **Why the flag-on half is not here.** Turning a flag on needs an admin, and this suite has no way
 * to make one — accounts are registered as ordinary users and there is no bootstrap endpoint. The
 * obvious shortcut, writing the role into the test stack's SQLite file from the host, is not
 * available either: the file is a Docker bind mount, SQLite's advisory locks do not carry across it
 * reliably, and a host-side write while the server holds it open corrupts the database. So the
 * flag-on behaviour — team creation, the Home page, the page tree, versions, the file library and
 * the whole role matrix — is covered by the service tests in `src/drive/teams/tests.rs`, which run
 * against a real database with the real migrations and drive the same service the handlers call.
 * `VERIFY.md` carries the manual steps for the browser half.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(request: APIRequestContext, email: string) {
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Team Test User', email, password: 'Password123!' },
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

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test.describe('with teamSpaces off', () => {
  test('the sidebar is unchanged and still says Shared Drives', async ({ request, page }) => {
    const email = uniqueEmail('team_off');
    await register(request, email);
    await signIn(page, email);

    await expect(page.getByRole('link', { name: 'Shared Drives' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: 'Shared Spaces' })).toHaveCount(0);
  });

  /**
   * 404 rather than 403. With the flag off the feature does not exist on this deployment, and 403
   * would confirm it is coming to anyone who probes the routes.
   */
  test('every team route reports itself as not found', async ({ request, page }) => {
    const email = uniqueEmail('team_off_api');
    await register(request, email);
    const token = await signIn(page, email);

    for (const path of [
      '/api/v1/drive/teams',
      '/api/v1/drive/teams/discoverable',
      '/api/v1/drive/teams/any-id',
      '/api/v1/drive/teams/any-id/pages',
      '/api/v1/drive/teams/any-id/members',
      '/api/v1/drive/teams/any-id/library',
      '/api/v1/drive/teams/any-id/activity',
      '/api/v1/drive/teams/any-id/join-requests',
    ]) {
      const res = await request.get(`${BASE_URL}${path}`, { headers: auth(token) });
      expect(res.status(), `${path} should be 404 while the flag is off`).toBe(404);
    }

    for (const path of [
      '/api/v1/drive/teams/any-id/join',
      '/api/v1/drive/teams/any-id/join-requests',
    ]) {
      const res = await request.post(`${BASE_URL}${path}`, { headers: auth(token), data: {} });
      expect(res.status(), `${path} should be 404 while the flag is off`).toBe(404);
    }

    const create = await request.post(`${BASE_URL}/api/v1/drive/teams`, {
      headers: auth(token),
      data: { name: 'Marketing' },
    });
    expect(create.status()).toBe(404);
  });

  /**
   * The gated routes are answered by the handler, not by the router falling through — a gated 404
   * carries the API's own error shape, an unrouted path returns the framework's empty one.
   *
   * Note what this does *not* prove: with the flag off, `/teams/discoverable` reaching the wrong
   * handler (`get_team` with an id of "discoverable") would answer 404 with this same body, so it
   * cannot tell correct route ordering from incorrect. That ordering is pinned by
   * `routing::the_discovery_route_is_not_swallowed_by_the_team_id_route` in `src/drive/teams/api.rs`,
   * which runs the real `configure` with the flag on.
   */
  test('a gated route is answered by the handler rather than unrouted', async ({
    request,
    page,
  }) => {
    const email = uniqueEmail('team_off_discover');
    await register(request, email);
    const token = await signIn(page, email);

    const res = await request.get(`${BASE_URL}/api/v1/drive/teams/discoverable`, {
      headers: auth(token),
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error?.code, 'the gate answers with the API error shape').toBeTruthy();
  });

  test('the team routes still require authentication', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/drive/teams`);
    expect(res.status()).toBe(401);
  });

  /**
   * The Shared Drives page and its endpoint are untouched by this release — they are what the six
   * iOS apps and the macOS client read, and what the flag falls back to.
   */
  test('Shared Drives still works', async ({ request, page }) => {
    const email = uniqueEmail('team_off_drives');
    await register(request, email);
    const token = await signIn(page, email);

    const res = await request.get(`${BASE_URL}/api/v1/drive/shared-drives`, {
      headers: auth(token),
    });
    expect(res.status()).toBe(200);

    await page.goto('/drive/team');
    await expect(page.getByRole('heading', { name: 'Shared Drives' })).toBeVisible({
      timeout: 15_000,
    });
  });

  /**
   * The Shared Spaces screen exists as a route but says the feature is off, rather than rendering
   * an empty team list that looks like a bug.
   */
  test('the Shared Spaces screen says the feature is not enabled', async ({ request, page }) => {
    const email = uniqueEmail('team_off_page');
    await register(request, email);
    await signIn(page, email);

    await page.goto('/teams');
    await expect(page.getByText('Team Spaces is not enabled')).toBeVisible({ timeout: 15_000 });
  });
});
