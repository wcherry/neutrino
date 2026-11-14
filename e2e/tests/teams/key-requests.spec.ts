/**
 * Asking a team for a file's key — UI roadmap stage 6. Someone who joins a team after a file was
 * added can see it but cannot open it; they ask, and an Owner seals the key to them and approves,
 * or denies with a reason. Two real accounts, each with its own encryption keys, in two browsers.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';

interface Session { token: string; id: string; email: string }

async function signUp(request: APIRequestContext, page: Page, name: string): Promise<Session> {
  const email = `keyreq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name, email, password: PASSWORD },
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

test.describe('Asking a team for a file’s key', () => {
  test('a late joiner asks, the owner approves, and the file opens for them', async ({ page, request, browser }) => {
    const owner = await signUp(request, page, 'Team Owner');

    const lateContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    try {
      const created = await request.post(`${BASE_URL}/api/v1/drive/teams`, { headers: json(owner.token), data: { name: 'Finance' } });
      const teamId = ((await created.json()) as { id: string }).id;

      // The owner adds two files while alone in the team: each is sealed to nobody else.
      await page.goto(`/teams/space?id=${teamId}&view=files`);
      for (const name of ['Budget.txt', 'Payroll.txt']) {
        await page.getByRole('main').locator('input[type="file"]').setInputFiles({
          name, mimeType: 'text/plain', buffer: Buffer.from(`${name} contents`),
        });
        await expect(page.getByText('File added to the team.').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(name)).toBeVisible();
      }
      const library = await request.get(`${BASE_URL}/api/v1/drive/teams/${teamId}/library`, { headers: json(owner.token) });
      const files = ((await library.json()) as { files: { id: string; name: string }[] }).files;
      const fileId = (n: string) => files.find((f) => f.name === n)!.id;

      // Then someone joins.
      const latePage = await lateContext.newPage();
      const late = await signUp(request, latePage, 'Late Joiner');
      const added = await request.post(`${BASE_URL}/api/v1/drive/teams/${teamId}/members`, {
        headers: json(owner.token), data: { email: late.email, role: 'viewer' },
      });
      expect(added.ok(), `add member: ${added.status()} ${await added.text()}`).toBeTruthy();
      const lateKey = (id: string) => request.get(`${BASE_URL}/api/v1/drive/files/${id}/key`, { headers: json(late.token) });
      expect((await lateKey(fileId('Budget.txt'))).status()).toBe(404);

      // They cannot open either file, so clicking one asks for its key.
      await latePage.goto(`/teams/space?id=${teamId}&view=files`);
      for (const [name, note] of [['Budget.txt', 'For the quarterly review'], ['Payroll.txt', '']]) {
        await latePage.getByText(name).click();
        const ask = latePage.getByRole('dialog');
        await expect(ask.getByText(/added before you joined/)).toBeVisible();
        if (note) await ask.getByLabel('Message (optional)').fill(note);
        await ask.getByRole('button', { name: 'Request key' }).click();
        await expect(latePage.getByText(/Request sent/).first()).toBeVisible();
      }

      // The owner sees both, approves one and denies the other with a reason.
      await page.reload();
      const requests = page.getByRole('list', { name: 'Key requests' });
      await expect(requests.getByText('For the quarterly review')).toBeVisible({ timeout: 15_000 });
      await requests.getByRole('button', { name: "Approve Late Joiner's request for Budget.txt" }).click();
      await expect(page.getByText('Late Joiner can now open the file.')).toBeVisible({ timeout: 15_000 });

      await requests.getByRole('button', { name: "Deny Late Joiner's request for Payroll.txt" }).click();
      const deny = page.getByRole('dialog');
      await deny.getByLabel('Reason (optional)').fill('Payroll is for HR only');
      await deny.getByRole('button', { name: 'Deny' }).click();
      await expect(page.getByText('Request denied.')).toBeVisible();
      await expect(page.getByRole('list', { name: 'Key requests' })).toHaveCount(0);

      // The approved file now has a key for them, and the listing no longer marks it.
      expect((await lateKey(fileId('Budget.txt'))).ok()).toBeTruthy();
      expect((await lateKey(fileId('Payroll.txt'))).status()).toBe(404);
      const theirs = await request.get(`${BASE_URL}/api/v1/drive/teams/${teamId}/library`, { headers: json(late.token) });
      const marks = Object.fromEntries(((await theirs.json()) as { files: { name: string; keyMissing: boolean }[] }).files.map((f) => [f.name, f.keyMissing]));
      expect(marks).toEqual({ 'Budget.txt': false, 'Payroll.txt': true });

      // And they were told both answers, the reason with the denial.
      await expect.poll(async () => {
        const res = await request.get(`${BASE_URL}/api/v1/drive/notifications`, { headers: json(late.token) });
        return ((await res.json()) as { notifications: { eventType: string; payload: string | Record<string, unknown> }[] }).notifications
          .map((n) => `${n.eventType}:${(typeof n.payload === 'string' ? JSON.parse(n.payload) : n.payload).reason ?? ''}`)
          .sort();
      }, { timeout: 10_000 }).toEqual(['team_key_approved:', 'team_key_denied:Payroll is for HR only']);

      // The approved file opens for them.
      await latePage.reload();
      await latePage.getByText('Budget.txt').click();
      await expect(latePage.getByRole('dialog').getByText(/added before you joined/)).toHaveCount(0);
    } finally {
      await lateContext.close();
    }
  });
});
