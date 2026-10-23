/**
 * What a team shares with its members — customization roadmap T3–T6, UI roadmap stage 6: pinned
 * resources in the space and the sidebar, the template gallery, palette shortcuts to templates, and
 * the shared library.
 *
 * Team Spaces ship behind a flag, which needs an administrator to switch: as in
 * `cross-cutting/shell-and-organisation.spec.ts`, the admin call uses a token with the admin claim
 * signed with the test stack's own JWT secret. Each test turns the flag back off in a `finally`.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';

function jwtSecret(): string {
  if (process.env.NEUTRINO_E2E_JWT_SECRET) return process.env.NEUTRINO_E2E_JWT_SECRET;
  return fs.readFileSync(path.join(__dirname, '../../secrets/jwt_secret.txt'), 'utf8').trim();
}

function adminToken(userId: string, email: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: userId, email, iat: now, exp: now + 900, is_admin: true });
  const sig = crypto.createHmac('sha256', jwtSecret()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

interface Session { token: string; id: string; email: string }

async function signUp(request: APIRequestContext, page: Page): Promise<Session> {
  const email = `teamshare_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Team Sharing Test', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok()).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
  const token = (await page.evaluate(() => localStorage.getItem('access_token')))!;
  const me = await request.get(`${BASE_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  return { token, email, id: (await me.json()).id };
}

const json = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function withTeamSpaces(request: APIRequestContext, s: Session, body: () => Promise<void>): Promise<void> {
  const admin = adminToken(s.id, s.email);
  const flag = (enabled: boolean) =>
    request.patch(`${BASE_URL}/api/v1/admin/feature-flags/teamSpaces`, { headers: json(admin), data: { enabled } });
  expect((await flag(true)).ok()).toBeTruthy();
  try {
    await body();
  } finally {
    await flag(false);
  }
}

async function createTeam(request: APIRequestContext, s: Session, name: string): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/teams`, { headers: json(s.token), data: { name } });
  expect(res.ok(), `create team: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

async function setTeamDefaults(request: APIRequestContext, s: Session, teamId: string, values: Record<string, unknown>) {
  const res = await request.patch(`${BASE_URL}/api/v1/drive/teams/${teamId}/preferences`, {
    headers: json(s.token),
    data: { values },
  });
  expect(res.ok(), `team defaults: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.describe('What a team shares with its members', () => {
  test('pinned resources appear under the team in the sidebar and in the space', async ({ page, request }) => {
    const s = await signUp(request, page);
    await withTeamSpaces(request, s, async () => {
      const teamId = await createTeam(request, s, 'Ops');
      await setTeamDefaults(request, s, teamId, {
        'team.pins': { items: [{ id: 'p1', kind: 'link', name: 'Status page', target: 'https://status.example.com' }] },
      });
      // The sidebar lists teams by name in the new looks.
      await request.patch(`${BASE_URL}/api/v1/preferences`, { headers: json(s.token), data: { values: { 'appearance.look': 'lightflow' } } });
      await page.goto('/drive');
      const nav = page.getByRole('navigation', { name: 'Primary navigation' });
      await expect(nav.getByRole('link', { name: 'Ops' })).toBeVisible({ timeout: 15_000 });
      const pin = nav.getByRole('link', { name: 'Status page' });
      await expect(pin).toHaveAttribute('href', 'https://status.example.com');
      await expect(pin).toHaveAttribute('target', '_blank');

      await page.goto(`/teams/space?id=${teamId}`);
      await expect(page.getByRole('list', { name: 'Pinned in Ops' }).getByText('Status page')).toBeVisible();
    });
  });

  test('a template in the team’s Files is in its gallery, and a shortcut to it is in the palette', async ({ page, request }) => {
    const s = await signUp(request, page);
    await withTeamSpaces(request, s, async () => {
      const teamId = await createTeam(request, s, 'Incidents');
      await page.goto(`/teams/space?id=${teamId}&view=files`);
      await page.getByRole('main').locator('input[type="file"]').setInputFiles({
        name: 'Incident report.dotx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
        buffer: fs.readFileSync(path.join(__dirname, '../../fixtures/sample.docx')),
      });
      await expect(page.getByText('File added to the team.')).toBeVisible({ timeout: 15_000 });

      await page.goto(`/teams/space?id=${teamId}&view=templates`);
      await expect(page.getByRole('list', { name: 'Incidents templates' }).getByText('Incident report')).toBeVisible();

      await page.goto(`/teams/space?id=${teamId}&view=settings`);
      await page.getByLabel('Shortcut name').fill('New incident report');
      await page.getByLabel('Template').selectOption({ label: 'Incident report.dotx' });
      await page.getByRole('button', { name: 'Add shortcut' }).click();
      await expect(page.getByRole('list', { name: 'Palette shortcuts' }).getByText('New incident report')).toBeVisible();

      // Members find it in the palette once their preferences are read again.
      await page.goto('/drive');
      await page.keyboard.press('ControlOrMeta+k');
      await page.keyboard.type('incident');
      await expect(page.getByRole('option', { name: /New incident report/ })).toBeVisible({ timeout: 10_000 });
    });
  });

  test('sharing the library publishes an encrypted file the Files view does not list', async ({ page, request }) => {
    const s = await signUp(request, page);
    await withTeamSpaces(request, s, async () => {
      const teamId = await createTeam(request, s, 'Design');
      await page.goto(`/teams/space?id=${teamId}&view=settings`);
      await page.getByRole('button', { name: 'Share my library with the team' }).click();
      await expect(page.getByText(/Library shared/)).toBeVisible({ timeout: 15_000 });

      const prefs = await request.get(`${BASE_URL}/api/v1/drive/teams/${teamId}/preferences`, { headers: json(s.token) });
      const pointer = (await prefs.json()).values['team.library'] as { fileId: string };
      expect(pointer.fileId).toBeTruthy();
      // Stored as ciphertext: it carries a sealed key like any team file.
      const key = await request.get(`${BASE_URL}/api/v1/drive/files/${pointer.fileId}/key`, { headers: json(s.token) });
      expect(key.ok()).toBeTruthy();

      await page.goto(`/teams/space?id=${teamId}&view=files`);
      await expect(page.getByText('.neutrino-team-library.json')).toHaveCount(0);
    });
  });
});
