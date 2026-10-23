/**
 * The instance's font library loads on demand: a page downloads a custom font's file only when
 * text uses that font, not every file on every load (72 fonts were 6.4 MB before Drive settled).
 * See `registerLazyFonts` in `providers/CustomFontsProvider.tsx`.
 *
 * Uploading fonts is admin-only: as in `teams/team-sharing.spec.ts`, the admin call uses a token
 * with the admin claim signed with the test stack's own JWT secret. The fixture is Playfair
 * Display (SIL OFL, `fixtures/fonts/OFL.txt`), uploaded under test-only names.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';
const FONT = fs.readFileSync(path.join(__dirname, '../../fixtures/fonts/playfair-display-latin-400-normal.woff2'));

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

async function signUp(request: APIRequestContext, page: Page): Promise<{ id: string; email: string }> {
  const email = `fonts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Fonts Test', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok()).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  const token = (await page.evaluate(() => localStorage.getItem('access_token')))!;
  const me = await request.get(`${BASE_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  return { email, id: (await me.json()).id };
}

/** The rendered width of a line of text in `family`, falling back to monospace. */
const widthIn = (page: Page, family: string) =>
  page.evaluate((f) => {
    let probe = document.getElementById('font-probe');
    if (!probe) {
      probe = document.createElement('span');
      probe.id = 'font-probe';
      probe.textContent = 'The quick brown fox jumps over the lazy dog';
      probe.style.cssText = 'position:absolute;top:0;left:0;font-size:32px;white-space:nowrap';
      document.body.appendChild(probe);
    }
    probe.style.fontFamily = `'${f}', monospace`;
    return probe.getBoundingClientRect().width;
  }, family);

test('custom fonts download only when a page uses them', async ({ page, request }) => {
  const user = await signUp(request, page);
  const admin = { Authorization: `Bearer ${adminToken(user.id, user.email)}` };
  const suffix = Math.random().toString(36).slice(2, 8);
  const names = ['A', 'B', 'C'].map((n) => `Lazy Test ${n} ${suffix}`);
  const ids: string[] = [];
  try {
    for (const name of names) {
      const res = await request.post(`${BASE_URL}/api/v1/admin/fonts`, {
        headers: admin,
        multipart: {
          display_name: name,
          file: { name: 'font.woff2', mimeType: 'font/woff2', buffer: FONT },
        },
      });
      expect(res.ok(), `upload: ${res.status()} ${await res.text()}`).toBeTruthy();
      ids.push(((await res.json()) as { id: string }).id);
    }

    const fetched: string[] = [];
    page.on('request', (req) => {
      const m = /\/api\/v1\/fonts\/([^/]+)\/file/.exec(req.url());
      if (m) fetched.push(m[1]);
    });

    await page.goto('/drive');
    await page.waitForLoadState('networkidle');
    expect(fetched, 'no font file is downloaded just by loading a page').toEqual([]);

    const monospace = await widthIn(page, 'no-such-font');
    await widthIn(page, names[1]);
    await expect.poll(() => widthIn(page, names[1]), { timeout: 10_000 }).not.toBeCloseTo(monospace, 0);
    expect(fetched).toEqual([ids[1]]);
  } finally {
    for (const id of ids) await request.delete(`${BASE_URL}/api/v1/admin/fonts/${id}`, { headers: admin });
  }
});
