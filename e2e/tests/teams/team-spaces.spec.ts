/**
 * Team Spaces end to end (issue #185).
 *
 * Team Spaces is always on: no feature is behind a flag while Neutrino is in beta. That makes the
 * whole feature reachable from an ordinary account, so this covers it as a user meets it — the
 * sidebar entry, creating a team, a non-member's view of one, moving and sharing a personal file
 * in, and the admin routes staying admin-only. The role matrix and the page tree are covered by
 * the service tests in `src/drive/teams/tests.rs`.
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

async function createTeam(request: APIRequestContext, token: string, name: string): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/teams`, {
    headers: auth(token),
    data: { name },
  });
  expect(res.ok(), `create team: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/** A plaintext file in the caller's own My Drive. */
async function uploadFile(request: APIRequestContext, token: string, name: string): Promise<string> {
  // Authorization only: `auth()` also sets `Content-Type: application/json`, which would replace
  // the multipart boundary Playwright generates.
  const upload = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { file: { name, mimeType: 'text/plain', buffer: Buffer.from('hello') } },
  });
  expect(upload.ok(), `upload failed: ${upload.status()} ${await upload.text()}`).toBeTruthy();
  return ((await upload.json()) as { id: string }).id;
}

test.describe('Team Spaces', () => {
  test('the sidebar offers Shared Spaces in place of Shared Drives', async ({ request, page }) => {
    const email = uniqueEmail('team_nav');
    await register(request, email);
    await signIn(page, email);

    await expect(page.getByRole('link', { name: 'Shared Spaces' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: 'Shared Drives' })).toHaveCount(0);
  });

  test('a new team is listed for its creator and on the Shared Spaces page', async ({
    request,
    page,
  }) => {
    const email = uniqueEmail('team_create');
    await register(request, email);
    const token = await signIn(page, email);

    const teamId = await createTeam(request, token, 'Marketing');

    const list = await request.get(`${BASE_URL}/api/v1/drive/teams`, { headers: auth(token) });
    expect(list.ok()).toBeTruthy();
    const teams = ((await list.json()) as { teams: { id: string; name: string }[] }).teams;
    expect(teams.map((t) => t.id)).toContain(teamId);

    await page.goto('/teams');
    await expect(page.getByText('Marketing').first()).toBeVisible({ timeout: 15_000 });
  });

  /**
   * A private team is invisible to anyone outside it: 404, not 403, because whether it exists is
   * itself something membership decides.
   */
  test("a non-member cannot see into someone else's team", async ({ request, page, browser }) => {
    const ownerEmail = uniqueEmail('team_owner');
    await register(request, ownerEmail);
    const ownerToken = await signIn(page, ownerEmail);
    const teamId = await createTeam(request, ownerToken, 'Private');

    const otherEmail = uniqueEmail('team_outsider');
    await register(request, otherEmail);
    const otherContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    try {
      const otherToken = await signIn(await otherContext.newPage(), otherEmail);
      for (const path of ['', '/pages', '/members', '/library', '/activity']) {
        const res = await request.get(`${BASE_URL}/api/v1/drive/teams/${teamId}${path}`, {
          headers: auth(otherToken),
        });
        expect(res.status(), `/teams/{id}${path} should be 404 to a non-member`).toBe(404);
      }
    } finally {
      await otherContext.close();
    }
  });

  test('a personal file can be shared with a team and moved into one', async ({ request, page }) => {
    const email = uniqueEmail('team_transfer');
    await register(request, email);
    const token = await signIn(page, email);
    const teamId = await createTeam(request, token, 'Ops');

    const lentId = await uploadFile(request, token, 'lent.txt');
    const shared = await request.post(`${BASE_URL}/api/v1/drive/teams/${teamId}/shares`, {
      headers: auth(token),
      data: { fileId: lentId, role: 'viewer' },
    });
    expect(shared.ok(), `share: ${shared.status()} ${await shared.text()}`).toBeTruthy();

    // A share lends the file: it stays the caller's.
    const info = await request.get(`${BASE_URL}/api/v1/drive/files/${lentId}/info`, {
      headers: auth(token),
    });
    expect(info.status()).toBe(200);

    const givenId = await uploadFile(request, token, 'given.txt');
    const moved = await request.post(`${BASE_URL}/api/v1/drive/teams/${teamId}/library/moves`, {
      headers: auth(token),
      data: { fileId: givenId },
    });
    expect(moved.ok(), `move: ${moved.status()} ${await moved.text()}`).toBeTruthy();

    const library = await request.get(`${BASE_URL}/api/v1/drive/teams/${teamId}/library`, {
      headers: auth(token),
    });
    expect(library.ok()).toBeTruthy();
    expect(JSON.stringify(await library.json())).toContain(givenId);
  });

  test('the team routes require authentication', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/drive/teams`);
    expect(res.status()).toBe(401);
  });

  /**
   * The 403 is the assertion the service tests cannot make: they prove what `admin_list_teams`
   * does once called, not who may call it. That the route takes `AdminUser` rather than
   * `AuthenticatedUser` is only observable from a wired stack.
   */
  test('the admin team routes are admin-only', async ({ request, page }) => {
    const email = uniqueEmail('team_admin');
    await register(request, email);
    const token = await signIn(page, email);

    const list = await request.get(`${BASE_URL}/api/v1/admin/teams`, { headers: auth(token) });
    expect(list.status(), 'an ordinary user must not read every team on the deployment').toBe(403);

    for (const [path, data] of [
      ['/api/v1/admin/teams/any-id/quota', { storageLimitBytes: 1024 }],
      ['/api/v1/admin/teams/any-id/owner', { email: 'someone@example.com' }],
      ['/api/v1/admin/teams/any-id/archived', { archived: true }],
    ] as const) {
      const res = await request.patch(`${BASE_URL}${path}`, { headers: auth(token), data });
      expect(res.status(), `${path} must be admin-only`).toBe(403);
    }

    const removed = await request.delete(`${BASE_URL}/api/v1/admin/teams/any-id`, {
      headers: auth(token),
    });
    expect(removed.status(), 'deleting a team must be admin-only').toBe(403);

    const anon = await request.get(`${BASE_URL}/api/v1/admin/teams`);
    expect(anon.status()).toBe(401);
  });

  /**
   * The Shared Drives page and its endpoint were not removed when Shared Spaces took its place in
   * the sidebar — the iOS apps and the macOS client read them.
   */
  test('Shared Drives still works', async ({ request, page }) => {
    const email = uniqueEmail('team_drives');
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
});
