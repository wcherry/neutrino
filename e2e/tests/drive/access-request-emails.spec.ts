/**
 * The emails around sharing that were missing: someone asks for access and the owner is mailed;
 * the owner answers on Drive › Access requests and the requester is mailed; access is taken away
 * and the person who lost it is mailed. Then the weekly email, as its preview shows it.
 *
 * Mail is read from the test stack's outbox (see `onboarding/invites.spec.ts`).
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';
const OUTBOX = path.join(process.env.RUN_DIR ?? '/tmp/neutrino-e2e/default', 'data', 'outbox.jsonl');

interface OutboxMessage {
  to: string;
  subject: string;
  body: string;
}

interface Account {
  email: string;
  name: string;
  id: string;
  token: string;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function mailTo(to: string, subject: string): OutboxMessage[] {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs
    .readFileSync(OUTBOX, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as OutboxMessage];
      } catch {
        return [];
      }
    })
    .filter((m) => m.to.toLowerCase() === to.toLowerCase() && m.subject === subject);
}

async function waitForMail(to: string, subject: string, timeoutMs = 15_000): Promise<OutboxMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = mailTo(to, subject);
    if (found.length > 0) return found[0];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no mail to ${to} matching ${subject} in ${OUTBOX} after ${timeoutMs}ms`);
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function account(request: APIRequestContext, prefix: string, name: string): Promise<Account> {
  const email = uniqueEmail(prefix);
  const reg = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name, email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(reg.ok(), `register failed: ${reg.status()} ${await reg.text()}`).toBeTruthy();
  const { id } = (await reg.json()) as { id: string };
  const login = await request.post(`${BASE_URL}/api/v1/auth/login`, {
    data: { email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = (await login.json()) as { accessToken: string };
  return { email, name, id, token: accessToken };
}

/** A plaintext file of the owner's, so approving has no key to hand over. */
async function upload(request: APIRequestContext, owner: Account, filename: string): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
    headers: { Authorization: `Bearer ${owner.token}` },
    multipart: {
      file: { name: filename, mimeType: 'text/plain', buffer: Buffer.from(`Content of ${filename}`) },
    },
  });
  expect(res.ok(), `upload failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

async function askForAccess(request: APIRequestContext, who: Account, fileId: string, message: string) {
  const res = await request.post(`${BASE_URL}/api/v1/drive/files/${fileId}/request-access`, {
    headers: auth(who.token),
    data: { requesterName: who.name, requestedRole: 'editor', message },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

test.describe('Access request emails', () => {
  test('asked, approved on the requests page, then revoked — each one mailed', async ({ page, request }) => {
    const owner = await account(request, 'access_owner', 'Olive Owner');
    const bob = await account(request, 'access_bob', 'Bob Asker');
    const fileName = `plan_${Date.now()}.txt`;
    const fileId = await upload(request, owner, fileName);

    await askForAccess(request, bob, fileId, 'For the Q4 review');
    const asked = await waitForMail(owner.email, `Bob Asker is asking for access to “${fileName}”`);
    expect(asked.body).toContain(`Bob Asker (${bob.email}) asked to edit the file “${fileName}”.`);
    expect(asked.body).toContain('“For the Q4 review”');
    const reviewLink = asked.body.match(/Review request: (\S+)/)![1];
    expect(new URL(reviewLink).pathname).toBe('/drive/requests');

    // The owner answers where the email points.
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
    // A fresh account meets the encryption setup first, which would otherwise sit over the page.
    await setUpEncryption(page);
    await page.goto('/drive/requests');
    const row = page.getByRole('listitem').filter({ hasText: fileName });
    await expect(row).toContainText(`Bob Asker (${bob.email}) asked to edit the file “${fileName}”.`);
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(row.getByRole('status')).toContainText('Bob Asker can now open it.');

    const approved = await waitForMail(bob.email, `Olive Owner gave you access to “${fileName}”`);
    expect(approved.body).toContain(`you can now edit the file “${fileName}”`);

    // Taking it away is mailed too.
    const revoke = await request.delete(`${BASE_URL}/api/v1/drive/files/${fileId}/permissions/${bob.id}`, {
      headers: auth(owner.token),
    });
    expect(revoke.ok(), await revoke.text()).toBeTruthy();
    const revoked = await waitForMail(bob.email, `Olive Owner removed your access to “${fileName}”`);
    expect(revoked.body).toContain(`You can no longer open the file “${fileName}”.`);
  });

  test('a declined request is mailed to the requester', async ({ request }) => {
    const owner = await account(request, 'deny_owner', 'Dana Owner');
    const bob = await account(request, 'deny_bob', 'Ben Asker');
    const fileName = `budget_${Date.now()}.txt`;
    const fileId = await upload(request, owner, fileName);
    const requestId = await askForAccess(request, bob, fileId, '');

    const deny = await request.post(`${BASE_URL}/api/v1/drive/access-requests/${requestId}/deny`, {
      headers: auth(owner.token),
    });
    expect(deny.ok(), await deny.text()).toBeTruthy();
    const declined = await waitForMail(bob.email, `Your request for “${fileName}” was declined`);
    expect(declined.body).toContain(`Dana Owner declined your request for access to the file “${fileName}”.`);
  });

  test('the weekly email preview counts the week’s requests', async ({ request }) => {
    const owner = await account(request, 'weekly_owner', 'Wendy Owner');
    const bob = await account(request, 'weekly_bob', 'Will Asker');

    const empty = await request.get(`${BASE_URL}/api/v1/weekly-email/preview`, { headers: auth(owner.token) });
    expect(empty.status()).toBe(204);

    const fileId = await upload(request, owner, `notes_${Date.now()}.txt`);
    await askForAccess(request, bob, fileId, '');
    // The request's notification is stored on a spawned task.
    await expect
      .poll(async () => (await request.get(`${BASE_URL}/api/v1/weekly-email/preview`, { headers: auth(owner.token) })).status())
      .toBe(200);
    const preview = (await (
      await request.get(`${BASE_URL}/api/v1/weekly-email/preview`, { headers: auth(owner.token) })
    ).json()) as { subject: string; text: string };
    expect(preview.subject).toMatch(/^Your week in Neutrino: /);
    expect(preview.text).toContain('1 request for access to your files.');

    // Writing product updates is an administrator's; an ordinary account is refused.
    const write = await request.post(`${BASE_URL}/api/v1/admin/product-updates`, {
      headers: auth(owner.token),
      data: { title: 'x', body: 'y' },
    });
    expect([401, 403]).toContain(write.status());
  });
});
